import type { FastifyRequest } from 'fastify';
import type { SqliteHhRaiseRepository } from '../candidate/sqliteHhRaiseRepository';
import type { SqliteHhSessionRepository } from '../candidate/sqliteHhSessionRepository';
import { HH_SESSION_SOURCE } from '../data/notificationPolicy';
import type { RouteDeps } from './deps';
import { notificationRepositoryFor, recordNotificationFromSource } from './notificationRepositoryAccess';

export interface HhSessionExpiry {
  readonly expired: boolean;
  readonly since: string | null;
}

/**
 * B690: вход в hh.ru истёк, если поднятие упёрлось в страницу входа позже, чем кандидат
 * последний раз читал резюме в окне hh.ru. Новое чтение резюме — это новый вход, признак уходит сам.
 */
export function hhSessionExpiry(
  raise: SqliteHhRaiseRepository,
  hh: SqliteHhSessionRepository,
  candidateId: string,
): HhSessionExpiry {
  const at = raise.latestLoggedOutAt(candidateId);
  const readAt = hh.getSnapshot(candidateId)?.readAt ?? null;
  if (!at || (readAt !== null && readAt >= at)) return { expired: false, since: null };
  return { expired: true, since: at };
}

/** Одно непрочитанное уведомление на всё время, пока вход истёк; повторные отказы его не множат. */
export function noteHhLoginExpired(deps: RouteDeps, request: FastifyRequest, candidateId: string, at: string): void {
  try {
    if (notificationRepositoryFor(deps).hasUnreadFromSource(candidateId, HH_SESSION_SOURCE)) return;
  } catch (error) {
    request.log.error({ code: 'hh_session_notice_read_failed', candidateId, failureType: error instanceof Error ? error.name : 'UnknownError' }, 'hh-session-notice-read-failed');
    return;
  }
  recordNotificationFromSource(deps, request, candidateId, {
    kind: 'delivery_error',
    sourceType: HH_SESSION_SOURCE,
    sourceId: 'hh',
    idempotencyKey: `${HH_SESSION_SOURCE}:${at}`,
  });
}

/** Кандидат снова вошёл в hh.ru: непрочитанное уведомление о входе больше не нужно. */
export function resolveHhLoginNotice(deps: RouteDeps, request: FastifyRequest, candidateId: string): void {
  try {
    notificationRepositoryFor(deps).withdrawUnreadFromSource(candidateId, HH_SESSION_SOURCE);
  } catch (error) {
    request.log.error({ code: 'hh_session_notice_resolve_failed', candidateId, failureType: error instanceof Error ? error.name : 'UnknownError' }, 'hh-session-notice-resolve-failed');
  }
}
