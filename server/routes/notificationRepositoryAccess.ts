import type { FastifyRequest } from 'fastify';
import type { RouteDeps } from './deps';
import { SqliteNotificationRepository } from '../data/sqliteNotificationRepository';
import type { NotificationEventInput } from '../data/notificationPolicy';

const repositories = new WeakMap<RouteDeps, SqliteNotificationRepository>();

export function notificationRepositoryFor(deps: RouteDeps): SqliteNotificationRepository {
  const shared = deps.candidateStore.notificationRepository;
  if (shared) return shared;
  const existing = repositories.get(deps);
  if (existing) return existing;
  const repository = new SqliteNotificationRepository({ databasePath: deps.config.databasePath });
  repositories.set(deps, repository);
  return repository;
}

export function closeNotificationRepositoryFor(deps: RouteDeps): void {
  if (deps.candidateStore.notificationRepository) return;
  const repository = repositories.get(deps);
  if (!repository) return;
  repository.close();
  repositories.delete(deps);
}

export function recordNotificationFromSource(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  input: NotificationEventInput,
): void {
  try {
    notificationRepositoryFor(deps).recordEvent(candidateId, input);
  } catch (error) {
    request.log.error(
      {
        code: 'notification_source_write_failed',
        candidateId,
        eventKind: input.kind,
        failureType: error instanceof Error ? error.name : 'UnknownError',
      },
      'candidate-notification-source-write-failed',
    );
  }
}

export function recordImportCompletedNotification(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  sourceType: string,
  sourceId: string,
): void {
  recordNotificationFromSource(deps, request, candidateId, {
    kind: 'import_completed',
    sourceType,
    sourceId,
    idempotencyKey: `${sourceType}:${sourceId}`,
  });
}
