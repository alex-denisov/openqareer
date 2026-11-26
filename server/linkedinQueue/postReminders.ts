import type { FastifyBaseLogger } from 'fastify';
import type { LinkedinQueueItem } from '../../shared/b640LinkedinQueue';
import type { SqliteNotificationRepository } from '../data/sqliteNotificationRepository';
import { LINKEDIN_COMMENT_SOURCE } from '../data/notificationPolicy';
import type { LinkedinQueueRepository } from './linkedinQueueRepository';

export const POST_REMINDER_SOURCE = 'linkedin_queue';

/** Вид уведомления один; пост и комментарий различает источник. */
const REMINDER_SOURCE: Readonly<Record<LinkedinQueueItem['kind'], string>> = {
  post: POST_REMINDER_SOURCE,
  comment: LINKEDIN_COMMENT_SOURCE,
};

type Notifications = Pick<SqliteNotificationRepository, 'recordEvent' | 'withdrawUnsentFromSource'>;
type QueueSlot = Pick<LinkedinQueueItem, 'id' | 'kind' | 'scheduledAt'>;

/**
 * B695: уведомление «Пора опубликовать пост» или «Пора оставить комментарий» для строки очереди LinkedIn. Пишется сразу со
 * временем строки (`createdAt` и `deliverAt` — время из ритма): в ленте не видно до него,
 * в Telegram уходит в тот же час по настройке «Напоминания». Перенос ставит новое, удаление,
 * публикация и «Остановить всё» снимают неотправленное. На LinkedIn ничего не уходит.
 */
export class PostReminders {
  constructor(
    private readonly queue: LinkedinQueueRepository,
    private readonly notifications: () => Notifications,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Строка встала в очередь или сменила время. */
  schedule(candidateId: string, slot: QueueSlot): void {
    this.guard(candidateId, 'schedule', () => {
      const sourceType = REMINDER_SOURCE[slot.kind];
      this.notifications().withdrawUnsentFromSource(candidateId, sourceType, slot.id);
      if (this.queue.isPaused(candidateId)) return;
      this.notifications().recordEvent(candidateId, {
        kind: 'post_reminder',
        sourceType,
        sourceId: slot.id,
        idempotencyKey: `post-reminder:${slot.id}:${slot.scheduledAt}`,
        createdAt: slot.scheduledAt,
        deliverAt: slot.scheduledAt,
      });
    });
  }

  /** Строка удалена или опубликована. */
  withdraw(candidateId: string, queueItemId: string): void {
    this.guard(candidateId, 'withdraw', () => {
      for (const sourceType of Object.values(REMINDER_SOURCE)) {
        this.notifications().withdrawUnsentFromSource(candidateId, sourceType, queueItemId);
      }
    });
  }

  /** «Остановить всё»: напоминаний очереди нет, пока пауза действует. */
  pauseAll(candidateId: string): void {
    for (const slot of this.queue.waiting(candidateId)) this.withdraw(candidateId, slot.id);
  }

  /** Пауза снята: каждой ждущей строке — снова её напоминание. */
  resumeAll(candidateId: string): void {
    for (const slot of this.queue.waiting(candidateId)) this.schedule(candidateId, slot);
  }

  /** Сбой уведомлений не ломает очередь: строка уже сохранена, ошибка — в журнал. */
  private guard(candidateId: string, step: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      this.log.error(
        {
          code: 'post_reminder_failed',
          step,
          candidateId,
          failureType: error instanceof Error ? error.name : 'UnknownError',
        },
        'linkedin-post-reminder-failed',
      );
    }
  }
}
