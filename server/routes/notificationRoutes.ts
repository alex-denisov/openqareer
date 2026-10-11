import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, sendError } from './helpers';
import {
  closeNotificationRepositoryFor,
  notificationRepositoryFor,
} from './notificationRepositoryAccess';
import { NotificationCursorError } from '../data/sqliteNotificationRepository';
import type { NotificationPreferenceKey } from '../data/notificationPolicy';
import { NotificationDeliveryProcessor } from '../notifications/notificationDelivery';
import {
  buildNotificationEmailSender,
  buildNotificationTelegramSender,
  buildTelegramWebhookConfigurator,
} from '../notifications/notificationProviders';
import { createNotificationUnsubscribeToken } from '../notifications/notificationToken';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(256).optional(),
});
const preferenceKeySchema = z.enum([
  'ev-reply',
  'ev-reminder',
  'ev-approval',
  'ev-delivery-error',
  'ev-target-company',
  'ev-weekly-digest',
]);
const preferenceBodySchema = z
  .object({ app: z.boolean(), email: z.boolean(), telegram: z.boolean().optional() })
  .strict();
const telegramWebhookReady = new WeakMap<RouteDeps, boolean>();

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const handleListNotifications: Handler = async (deps, request, reply) => {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const query = listQuerySchema.safeParse(request.query ?? {});
  if (!query.success)
    return sendError(
      reply,
      request,
      400,
      'invalid_notification_page',
      'Проверьте параметры списка уведомлений.',
      false,
    );
  try {
    const data = notificationRepositoryFor(deps).list(candidate.id, {
      ...query.data,
      now: new Date().toISOString(),
    });
    return { data, meta: { requestId: request.id } };
  } catch (error) {
    return handleNotificationListFailure(request, reply, candidate.id, error);
  }
};

function handleNotificationListFailure(
  request: FastifyRequest,
  reply: FastifyReply,
  candidateId: string,
  error: unknown,
): unknown {
  if (error instanceof NotificationCursorError)
    return sendError(
      reply,
      request,
      400,
      'invalid_notification_cursor',
      'Не удалось продолжить этот список. Обновите страницу.',
      false,
    );
  request.log.error(
    {
      code: 'notification_list_failed',
      candidateId,
      failureType: error instanceof Error ? error.name : 'UnknownError',
    },
    'candidate-notification-list-failed',
  );
  return sendError(
    reply,
    request,
    503,
    'notification_storage_unavailable',
    'Уведомления временно недоступны.',
    true,
  );
}

const handleMarkNotificationRead: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  if (!params.success)
    return sendError(
      reply,
      request,
      400,
      'invalid_notification_id',
      'Проверьте уведомление.',
      false,
    );
  const readAt = new Date().toISOString();
  const changed = notificationRepositoryFor(deps).markRead(candidate.id, params.data.id, readAt);
  if (!changed)
    return sendError(
      reply,
      request,
      404,
      'notification_not_found',
      'Уведомление не найдено.',
      false,
    );
  return { data: { id: params.data.id, readAt }, meta: { requestId: request.id } };
};

const handleMarkAllNotificationsRead: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const updated = notificationRepositoryFor(deps).markAllRead(
    candidate.id,
    new Date().toISOString(),
  );
  return { data: { updated }, meta: { requestId: request.id } };
};

const handleGetNotificationPreferences: Handler = async (deps, request, reply) => {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  return {
    data: { events: notificationRepositoryFor(deps).getPreferences(candidate.id) },
    meta: { requestId: request.id },
  };
};

const handleSetNotificationPreference: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const params = z.object({ key: preferenceKeySchema }).safeParse(request.params);
  const body = preferenceBodySchema.safeParse(request.body);
  if (!params.success || !body.success)
    return sendError(
      reply,
      request,
      400,
      'invalid_notification_preference',
      'Проверьте настройки события.',
      false,
    );
  const updatedAt = new Date().toISOString();
  const data = notificationRepositoryFor(deps).setPreference(
    candidate.id,
    params.data.key as NotificationPreferenceKey,
    body.data,
    updatedAt,
  );
  return { data: { ...data, updatedAt }, meta: { requestId: request.id } };
};

const handleGetNotificationChannels: Handler = async (deps, request, reply) => {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const status = notificationRepositoryFor(deps).getTelegramLinkStatus(candidate.id);
  const telegramAvailable = telegramWebhookReady.get(deps) === true;
  return {
    data: {
      emailAvailable: Boolean(deps.config.accountEmail),
      telegram: {
        available: telegramAvailable,
        connected: status.connected,
        linkedAt: status.linkedAt,
        botUsername: 'openqareer_bot',
      },
      mandatory: {
        security: { app: true, email: true, telegram: false, locked: true, sourceAvailable: false },
        payments: { app: true, email: true, telegram: false, locked: true, sourceAvailable: false },
      },
    },
    meta: { requestId: request.id },
  };
};

const handleStartTelegramLink: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  if (telegramWebhookReady.get(deps) !== true) {
    return sendError(
      reply,
      request,
      503,
      'telegram_unavailable',
      'Подключение Telegram пока недоступно.',
      true,
    );
  }
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1_000).toISOString();
  notificationRepositoryFor(deps).createTelegramLinkCode(
    candidate.id,
    opaqueTokenHash('telegram-link-v1', token),
    expiresAt,
    now.toISOString(),
  );
  return {
    data: { startUrl: `https://t.me/openqareer_bot?start=${token}`, expiresAt },
    meta: { requestId: request.id },
  };
};

const handleUnlinkTelegram: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const disconnected = notificationRepositoryFor(deps).unlinkTelegramChat(candidate.id);
  return { data: { connected: false, disconnected }, meta: { requestId: request.id } };
};

async function handleTelegramWebhook(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const expected = deps.config.telegramWebhookSecret;
  const supplied = request.headers['x-telegram-bot-api-secret-token'];
  if (!expected || !isSecretMatch(expected, typeof supplied === 'string' ? supplied : '')) {
    return sendError(
      reply,
      request,
      401,
      'telegram_webhook_unauthorized',
      'Запрос не принят.',
      false,
    );
  }
  const update = telegramUpdateSchema.safeParse(request.body);
  if (!update.success || !update.data.message?.text) return { ok: true };
  const match = update.data.message.text.match(
    /^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{40,64})$/u,
  );
  if (!match) return { ok: true };
  const chatId = String(update.data.message.chat.id);
  const candidateId = notificationRepositoryFor(deps).consumeTelegramLinkCode(
    opaqueTokenHash('telegram-link-v1', match[1]!),
    chatId,
  );
  if (candidateId && deps.config.telegramBotToken) {
    try {
      await buildNotificationTelegramSender(deps.config.telegramBotToken)({
        chatId,
        text: 'Уведомления openqareer подключены. Управлять ими можно в настройках аккаунта.',
      });
    } catch (error) {
      request.log.error(
        {
          code: 'telegram_link_confirmation_failed',
          candidateId,
          failureType: error instanceof Error ? error.name : 'UnknownError',
        },
        'candidate-telegram-link-confirmation-failed',
      );
    }
  }
  return { ok: true };
}

const unsubscribeQuerySchema = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) })
  .strict();

async function handleUnsubscribePage(request: FastifyRequest, reply: FastifyReply) {
  const query = unsubscribeQuerySchema.safeParse(request.query);
  if (!query.success)
    return sendError(
      reply,
      request,
      400,
      'invalid_unsubscribe_token',
      'Ссылка недействительна или устарела.',
      false,
    );
  const token = query.data.token;
  reply.type('text/html; charset=utf-8');
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Настройки писем — openqareer</title><main><h1>Отписаться от необязательных писем?</h1><p>Обязательные сообщения о безопасности и платежах останутся включены.</p><form method="post" action="/api/v1/candidate/notifications/unsubscribe"><input type="hidden" name="token" value="${token}"><button type="submit">Отписаться</button></form></main></html>`;
}

async function handleUnsubscribe(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const body = z
    .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) })
    .safeParse(request.body);
  if (!body.success)
    return sendError(
      reply,
      request,
      400,
      'invalid_unsubscribe_token',
      'Ссылка недействительна или устарела.',
      false,
    );
  const changed = notificationRepositoryFor(deps).unsubscribeEmail(
    opaqueTokenHash('notification-unsubscribe-v1', body.data.token),
  );
  if (!changed)
    return sendError(
      reply,
      request,
      400,
      'invalid_unsubscribe_token',
      'Ссылка недействительна или устарела.',
      false,
    );
  reply.type('text/html; charset=utf-8');
  return '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Готово — openqareer</title><main><h1>Настройки писем обновлены</h1><p>Необязательные письма отключены. Обязательные сообщения останутся включены.</p></main></html>';
}

export function registerNotificationRoutes(app: FastifyInstance, deps: RouteDeps): void {
  notificationRepositoryFor(deps);
  app.addHook('onClose', () => closeNotificationRepositoryFor(deps));
  registerUnsubscribeFormParser(app);
  startDeliveryWorker(app, deps);
  registerInboxRoutes(app, deps);
  registerChannelRoutes(app, deps);
  registerExternalChannelRoutes(app, deps);
}

function registerInboxRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    '/api/v1/candidate/notifications',
    { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } },
    async (request, reply) => handleListNotifications(deps, request, reply),
  );
  app.put(
    '/api/v1/candidate/notifications/:id/read',
    { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } },
    async (request, reply) => handleMarkNotificationRead(deps, request, reply),
  );
  app.put(
    '/api/v1/candidate/notifications/read-all',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (request, reply) => handleMarkAllNotificationsRead(deps, request, reply),
  );
  app.get('/api/v1/candidate/notifications/preferences', async (request, reply) =>
    handleGetNotificationPreferences(deps, request, reply),
  );
  app.put('/api/v1/candidate/notifications/preferences/:key', async (request, reply) =>
    handleSetNotificationPreference(deps, request, reply),
  );
}

function registerChannelRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    '/api/v1/candidate/notifications/channels',
    { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } },
    async (request, reply) => handleGetNotificationChannels(deps, request, reply),
  );
  app.post(
    '/api/v1/candidate/notifications/telegram/link',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request, reply) => handleStartTelegramLink(deps, request, reply),
  );
  app.delete(
    '/api/v1/candidate/notifications/telegram/connection',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request, reply) => handleUnlinkTelegram(deps, request, reply),
  );
}

function registerExternalChannelRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    '/api/v1/integrations/telegram/webhook',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => handleTelegramWebhook(deps, request, reply),
  );
  app.get('/api/v1/candidate/notifications/unsubscribe', async (request, reply) =>
    handleUnsubscribePage(request, reply),
  );
  app.post(
    '/api/v1/candidate/notifications/unsubscribe',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request, reply) => handleUnsubscribe(deps, request, reply),
  );
}

const telegramUpdateSchema = z
  .object({
    message: z
      .object({
        text: z.string().max(200).optional(),
        chat: z.object({
          id: z.union([z.number().int().safe(), z.string().regex(/^-?[0-9]{1,20}$/u)]),
        }),
      })
      .optional(),
  })
  .passthrough();

function opaqueTokenHash(purpose: string, token: string): string {
  return createHash('sha256').update(`openqareer:${purpose}:\0${token}`).digest('hex');
}

function isSecretMatch(expected: string, supplied: string): boolean {
  const expectedBytes = Buffer.from(expected, 'utf8');
  const suppliedBytes = Buffer.from(supplied, 'utf8');
  return (
    expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

function registerUnsubscribeFormParser(app: FastifyInstance): void {
  if (app.hasContentTypeParser('application/x-www-form-urlencoded')) return;
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: 1_024 },
    (_request, body, done) => {
      const fields = new URLSearchParams(String(body));
      done(null, { token: fields.get('token') ?? '' });
    },
  );
}

function startDeliveryWorker(app: FastifyInstance, deps: RouteDeps): void {
  const emailConfig = deps.config.accountEmail;
  const botToken = deps.config.telegramBotToken;
  const webhookSecret = deps.config.telegramWebhookSecret;
  const publicBaseUrl = deps.config.publicBaseUrl ?? emailConfig?.publicBaseUrl;
  telegramWebhookReady.set(deps, false);
  if (!emailConfig && !(botToken && publicBaseUrl)) return;
  const repository = notificationRepositoryFor(deps);
  const processor = createDeliveryProcessor(
    deps,
    repository,
    emailConfig,
    botToken,
    publicBaseUrl!,
  );
  startDeliveryPoller(app, processor);
  if (botToken && webhookSecret && publicBaseUrl) {
    startTelegramWebhookRegistration(app, deps, botToken, webhookSecret, publicBaseUrl);
  }
}

function createDeliveryProcessor(
  deps: RouteDeps,
  repository: ReturnType<typeof notificationRepositoryFor>,
  emailConfig: RouteDeps['config']['accountEmail'],
  botToken: string | undefined,
  publicBaseUrl: string,
): NotificationDeliveryProcessor {
  return new NotificationDeliveryProcessor({
    repository,
    publicBaseUrl,
    resolveEmail: (candidateId) => deps.authService.getCandidateEmail?.(candidateId) ?? null,
    createUnsubscribeUrl: (candidateId) =>
      createUnsubscribeUrl(repository, publicBaseUrl, candidateId, deps.config.dataEncryptionKey),
    ...(emailConfig ? { sendEmail: buildNotificationEmailSender(emailConfig) } : {}),
    ...(botToken ? { sendTelegram: buildNotificationTelegramSender(botToken) } : {}),
  });
}

function startDeliveryPoller(app: FastifyInstance, processor: NotificationDeliveryProcessor): void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await processor.processDue();
      if (result.failed > 0) {
        app.log.error(
          {
            code: 'notification_delivery_batch_failed',
            claimed: result.claimed,
            failed: result.failed,
          },
          'candidate-notification-delivery-batch-failed',
        );
      }
    } catch (error) {
      app.log.error(
        {
          code: 'notification_delivery_worker_failed',
          failureType: error instanceof Error ? error.name : 'UnknownError',
        },
        'candidate-notification-delivery-worker-failed',
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), 15_000);
  timer.unref();
  app.addHook('onClose', () => clearInterval(timer));
  setTimeout(() => void run(), 0)?.unref();
}

function startTelegramWebhookRegistration(
  app: FastifyInstance,
  deps: RouteDeps,
  botToken: string,
  webhookSecret: string,
  publicBaseUrl: string,
): void {
  const configureWebhook = buildTelegramWebhookConfigurator(botToken, publicBaseUrl, webhookSecret);
  let configuring = false;
  const registerWebhook = async () => {
    if (configuring || telegramWebhookReady.get(deps)) return;
    configuring = true;
    try {
      await configureWebhook();
      telegramWebhookReady.set(deps, true);
    } catch (error) {
      app.log.error(
        {
          code: 'telegram_webhook_setup_failed',
          failureType: error instanceof Error ? error.name : 'UnknownError',
        },
        'candidate-telegram-webhook-setup-failed',
      );
    } finally {
      configuring = false;
    }
  };
  const timer = setInterval(() => void registerWebhook(), 5 * 60_000);
  timer.unref();
  app.addHook('onClose', () => clearInterval(timer));
  setTimeout(() => void registerWebhook(), 0)?.unref();
}

function createUnsubscribeUrl(
  repository: ReturnType<typeof notificationRepositoryFor>,
  publicBaseUrl: string,
  candidateId: string,
  tokenKey: Buffer,
): string {
  const token = createNotificationUnsubscribeToken(candidateId, tokenKey);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000).toISOString();
  repository.issueUnsubscribeToken(
    candidateId,
    opaqueTokenHash('notification-unsubscribe-v1', token),
    expiresAt,
    now.toISOString(),
  );
  const url = new URL('/api/v1/candidate/notifications/unsubscribe', publicBaseUrl);
  url.searchParams.set('token', token);
  return url.toString();
}
