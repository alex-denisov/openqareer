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
  /** Таблица имён уже есть: стирать можно без флага, не создавая её. */
  readonly hasNames: () => boolean;
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
    hasNames: () => {
      if (store) return true;
      users ??= new DatabaseSync(deps.config.databasePath, { readOnly: true });
      return Boolean(users.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidate_telegram_usernames'").get());
    },
    close: () => {
      try {
        store?.close();
      } finally {
        users?.close();
      }
    },
  };
  bindings.set(deps, bound);
  return bound;
}

function logFailure(log: FastifyBaseLogger, candidateId: string, error: unknown): void {
  log.error({ code: 'telegram_username_failed', candidateId, failureType: error instanceof Error ? error.name : 'UnknownError' }, 'candidate-telegram-username-failed');
}

/** Вебхук: после привязки запомнить имя в Telegram, если оно есть и у кандидата новый кабинет. */
export function rememberTelegramUsername(deps: RouteDeps, log: FastifyBaseLogger, candidateId: string, raw: unknown): void {
  try {
    const username = normalizeTelegramUsername(raw);
    const bound = bind(deps);
    if (username && bound.flagged(candidateId)) bound.store().save(candidateId, username);
    else if (bound.hasNames()) bound.store().remove(candidateId);
  } catch (error) {
    logFailure(log, candidateId, error);
  }
}

/** Отвязка: имя стирается и без флага, если оно когда-то было записано. */
export function forgetTelegramUsername(deps: RouteDeps, log: FastifyBaseLogger, candidateId: string): void {
  rememberTelegramUsername(deps, log, candidateId, null);
}

function readUsername(deps: RouteDeps, log: FastifyBaseLogger, candidateId: string): string | null {
  try {
    return bind(deps).store().get(candidateId);
  } catch (error) {
    // Сменился ключ или запись повреждена: строка покажет «Telegram подключён» без имени.
    logFailure(log, candidateId, error);
    return null;
  }
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
  const username = link.state === 'connected' ? readUsername(deps, request.log, candidateId) : null;
  reply.header('Cache-Control', 'private, no-store');
  return { data: { ...link, username: username ? `@${username}` : null }, meta: { requestId: request.id } };
}

export function registerTelegramLinkStateRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.addHook('onClose', () => bindings.get(deps)?.close());
  app.get(
    '/api/v1/candidate/notifications/telegram/state',
    // Экран опрашивает раз в 3 с, пока ждёт подтверждения: до 1200 чтений в час с вкладки.
    { config: { rateLimit: { max: 1500, timeWindow: '1 hour' } } },
    (request, reply) => handleState(deps, request, reply),
  );
}
