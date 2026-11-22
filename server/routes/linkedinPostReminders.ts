import type { DatabaseSync } from 'node:sqlite';
import type { FastifyBaseLogger } from 'fastify';
import { LinkedinQueueRepository } from '../linkedinQueue/linkedinQueueRepository';
import { PostReminders } from '../linkedinQueue/postReminders';
import type { RouteDeps } from './deps';
import { notificationRepositoryFor } from './notificationRepositoryAccess';

const queues = new WeakMap<DatabaseSync, LinkedinQueueRepository>();

/** Очередь LinkedIn (B694) на базе черновиков; без таблицы черновиков очереди нет. */
export function linkedinQueueFor(deps: RouteDeps): LinkedinQueueRepository | null {
  const database = deps.candidateActionRepository?.getDatabase();
  if (!database) return null;
  const known = queues.get(database);
  if (known) return known;
  const hasDrafts = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidate_drafts'")
    .get();
  if (!hasDrafts) return null;
  const queue = new LinkedinQueueRepository(database);
  queues.set(database, queue);
  return queue;
}

/** B695: напоминания о постах очереди — для маршрутов очереди и «Остановить всё». */
export function postRemindersFor(
  deps: RouteDeps,
  log: FastifyBaseLogger,
  queue = linkedinQueueFor(deps),
): PostReminders | null {
  return queue ? new PostReminders(queue, () => notificationRepositoryFor(deps), log) : null;
}
