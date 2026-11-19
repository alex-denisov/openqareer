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
 * B690: вход в hh.ru истёк, если поднятие упёрлось в страницу входа позже, чем вход последний раз
 * был жив: кандидат читал резюме в окне hh.ru или поднятие прошло. `since` — первый упор с тех пор.
 */
export function hhSessionExpiry(
  raise: SqliteHhRaiseRepository,
  hh: SqliteHhSessionRepository,
  candidateId: string,
): HhSessionExpiry {
  const readAt = hh.getSnapshot(candidateId)?.readAt ?? null;
  const { loggedOutFrom } = raise.loginMarks(candidateId, readAt);
  return loggedOutFrom ? { expired: true, since: loggedOutFrom } : { expired: false, since: null };
}

/**
 * Одно уведомление на всё время, пока вход истёк: ключ — начало этого периода, так что повтор
 * после сбоя записи не плодит дубль, а прочитанное не возвращается при следующих отказах.
 */
export function noteHhLoginExpired(deps: RouteDeps, request: FastifyRequest, candidateId: string, since: string): void {
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
    idempotencyKey: `${HH_SESSION_SOURCE}:${since}`,
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
