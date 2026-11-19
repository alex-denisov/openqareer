import { DatabaseSync } from 'node:sqlite';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { candidateFlagLookup } from '../candidate/hhRaiseQueue';
import { SealedText } from '../data/sealedText';
import {
  normalizeTelegramUsername,
  SqliteTelegramUsernameStore,
  telegramLinkState,
} from '../notifications/telegramUsernameStore';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { notificationRepositoryFor } from './notificationRepositoryAccess';
import { sendError } from './helpers';

/**
 * B690: состояние привязки Telegram для n02 — «ждём подтверждения», «ссылка устарела»,
 * «Telegram · @имя». Маршрут закрыт флагом нового кабинета; имя запоминается вебхуком
 * только для кандидатов с флагом. Идентификатор чата наружу не отдаётся.
 */
interface Bound {
  readonly store: () => SqliteTelegramUsernameStore;
  readonly flagged: (candidateId: string) => boolean;
  readonly close: () => void;
}

const bindings = new WeakMap<RouteDeps, Bound>();

function bind(deps: RouteDeps): Bound {
  const existing = bindings.get(deps);
  if (existing) return existing;
  let store: SqliteTelegramUsernameStore | null = null;
  let users: DatabaseSync | null = null;
  let lookup: ((candidateId: string) => boolean) | null = null;
  const bound: Bound = {
    store: () =>
      (store ??= new SqliteTelegramUsernameStore(
        { databasePath: deps.config.databasePath },
        new SealedText(deps.config.dataEncryptionKey),
      )),
    flagged: (candidateId) => {
      if ((deps.config.cabinetB640Usernames ?? []).length === 0) return false;
      users ??= new DatabaseSync(deps.config.databasePath, { readOnly: true });
      lookup ??= candidateFlagLookup(users, deps.config);
      return lookup(candidateId);
    },
    close: () => {
      store?.close();
      users?.close();
    },
  };
  bindings.set(deps, bound);
  return bound;
}

/** Вебхук: после привязки запомнить имя в Telegram, если оно есть и у кандидата новый кабинет. */
export function rememberTelegramUsername(deps: RouteDeps, log: FastifyBaseLogger, candidateId: string, raw: unknown): void {
  try {
    const username = normalizeTelegramUsername(raw);
    const bound = bind(deps);
    if (!bound.flagged(candidateId)) return;
    if (username) bound.store().save(candidateId, username);
    else bound.store().remove(candidateId);
  } catch (error) {
    log.error({ code: 'telegram_username_save_failed', candidateId, failureType: error instanceof Error ? error.name : 'UnknownError' }, 'candidate-telegram-username-save-failed');
  }
}

/** Отвязка: имя больше не показывается. */
export function forgetTelegramUsername(deps: RouteDeps, log: FastifyBaseLogger, candidateId: string): void {
  rememberTelegramUsername(deps, log, candidateId, null);
}

async function handleState(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return undefined;
  if (!principal.candidate) return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
  const candidateId = principal.candidate.id;
  const repository = notificationRepositoryFor(deps);
  const link = telegramLinkState({
    connected: repository.getTelegramLinkStatus(candidateId).connected,
    codeExpiresAt: repository.getTelegramLinkCodeExpiry(candidateId),
    now: new Date().toISOString(),
  });
  const username = link.state === 'connected' ? bind(deps).store().get(candidateId) : null;
  reply.header('Cache-Control', 'private, no-store');
  return { data: { ...link, username: username ? `@${username}` : null }, meta: { requestId: request.id } };
}

export function registerTelegramLinkStateRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.addHook('onClose', () => bindings.get(deps)?.close());
  app.get(
    '/api/v1/candidate/notifications/telegram/state',
    { config: { rateLimit: { max: 600, timeWindow: '1 hour' } } },
    (request, reply) => handleState(deps, request, reply),
  );
}
