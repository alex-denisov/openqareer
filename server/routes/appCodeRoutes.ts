import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppCodeStore, CHALLENGE_PATTERN } from '../auth/appCodeStore';
import { cabinetB640Enabled } from '../auth/cabinetB640Access';
import type { ServerConfig } from '../config';
import type { RouteDeps } from './deps';
import {
  csrfError,
  publicPrincipal,
  requireVerifiedEmail,
  sendError,
  sessionCookieName,
  withDeps,
} from './helpers';
import { IMPERSONATED_CODE, IMPERSONATED_MESSAGE } from './twoFactorRoutes';

const stores = new WeakMap<RouteDeps['config'], AppCodeStore>();

/** Одно хранилище кодов на конфигурацию приложения; закрывается вместе с ним. */
function appCodeStoreFor(deps: Pick<RouteDeps, 'config'>): AppCodeStore {
  const existing = stores.get(deps.config);
  if (existing) return existing;
  const store = new AppCodeStore({ databasePath: deps.config.databasePath });
  stores.set(deps.config, store);
  return store;
}

const issueSchema = z.object({ challenge: z.string().regex(CHALLENGE_PATTERN) }).strict();
const exchangeSchema = z
  .object({ code: z.string().max(100), verifier: z.string().max(128) })
  .strict();

const APP_ORIGINS = new Set([
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
]);

/** Адрес сайта, с которого страница /app-sign-in просит код: только он, не приложение и не пусто. */
function isSiteOrigin(origin: string | undefined, config: ServerConfig): boolean {
  if (!origin || APP_ORIGINS.has(origin)) return false;
  if (config.publicBaseUrl) return origin === new URL(config.publicBaseUrl).origin;
  return config.allowedOrigins.includes(origin);
}

const clientDeviceId = (request: FastifyRequest): string | undefined => {
  const value = request.headers['x-openqareer-device-id'];
  return typeof value === 'string' ? value : undefined;
};

/**
 * Код для приложения выдаёт только сессия сайта в cookie с адреса сайта. Bearer (токен
 * приложения или украденный токен) код не получит: иначе любой держатель токена плодил бы сессии.
 */
async function postIssue(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (request.headers.authorization) {
    return sendError(reply, request, 403, 'app_code_cookie_only', 'Войдите на сайте.', false);
  }
  if (!isSiteOrigin(request.headers.origin, deps.config)) return csrfError(request, reply);
  const token = request.cookies[sessionCookieName(deps.config.secureCookies)] ?? '';
  const principal = token ? deps.authService.authenticate(token) : null;
  if (!principal) {
    return sendError(reply, request, 401, 'unauthorized', 'Войдите на сайте.', false);
  }
  // Сессия администратора «от имени» кандидата и неподтверждённая почта сессию приложения не выдают:
  // новая сессия не несла бы отметку подмены, а письмо о входе некуда отправить.
  if (!requireVerifiedEmail(request, reply, principal)) return reply;
  if (principal.impersonatedBy) {
    return sendError(reply, request, 403, IMPERSONATED_CODE, IMPERSONATED_MESSAGE, false);
  }
  const body = issueSchema.safeParse(request.body);
  if (!body.success || !cabinetB640Enabled(deps.config, principal.username)) {
    return sendError(
      reply,
      request,
      400,
      'app_code_invalid',
      'Начните вход в приложении заново.',
      false,
    );
  }
  const code = appCodeStoreFor(deps).issue(principal.userId, body.data.challenge, new Date());
  return { data: { code }, meta: { requestId: request.id } };
}

/** Обмен кода на сессию приложения: код одноразовый, 60 с, и только с verifier, что держит приложение. */
async function postExchange(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const refuse = () =>
    sendError(
      reply,
      request,
      400,
      'app_code_invalid',
      'Не удалось войти. Попробуйте ещё раз.',
      false,
    );
  const body = exchangeSchema.safeParse(request.body);
  if (!body.success) return refuse();
  const now = new Date();
  const userId = appCodeStoreFor(deps).redeem(body.data.code, body.data.verifier, now);
  const issued = userId
    ? (deps.authService.issueAppSession?.(userId, clientDeviceId(request)) ?? null)
    : null;
  if (!userId || !issued) return refuse();
  deps.authService
    .notifyAppSignIn?.(userId, now)
    ?.catch((error: unknown) => request.log.error({ err: error }, 'app sign-in email failed'));
  return {
    data: { ...publicPrincipal(issued.principal, deps.config), sessionToken: issued.sessionToken },
    meta: { requestId: request.id },
  };
}

const limit = { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } };

/** B755: вход в приложение через системный лист — код на сайте, обмен в приложении. */
export function registerAppCodeRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.addHook('onClose', async () => {
    stores.get(deps.config)?.close();
    stores.delete(deps.config);
  });
  app.post('/api/v1/auth/app-code', limit, withDeps(deps, postIssue));
  app.post('/api/v1/auth/app-code/exchange', limit, withDeps(deps, postExchange));
}
