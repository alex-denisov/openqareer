import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SealedText } from '../data/sealedText';
import { SqliteNotificationRepository } from '../data/sqliteNotificationRepository';
import { NotificationDeliveryProcessor } from './notificationDelivery';

const NOW = '2026-10-11T12:00:00.000Z';
const repositories: SqliteNotificationRepository[] = [];
const databases: DatabaseSync[] = [];

afterEach(() => {
  repositories.splice(0).forEach((repository) => repository.close());
  databases.splice(0).forEach((database) => database.close());
});

function createRepository(): SqliteNotificationRepository {
  const database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
  database.prepare('INSERT INTO candidates (id) VALUES (?)').run('candidate-a');
  const repository = new SqliteNotificationRepository(
    database,
    new SealedText(Buffer.alloc(32, 4)),
  );
  databases.push(database);
  repositories.push(repository);
  return repository;
}

function addReply(repository: SqliteNotificationRepository): void {
  repository.setPreference(
    'candidate-a',
    'ev-reply',
    { app: false, email: true, telegram: true },
    NOW,
  );
  repository.linkTelegramChat('candidate-a', '100', NOW);
  repository.recordEvent(
    'candidate-a',
    {
      idempotencyKey: 'reply:1',
      kind: 'employer_reply',
      sourceType: 'application',
      sourceId: 'application-1',
    },
    NOW,
  );
}

describe('notification channel delivery processor', () => {
  it('sends selected channels once with a stable email idempotency key', async () => {
    const repository = createRepository();
    addReply(repository);
    const sendEmail = vi.fn(async () => ({ providerId: 'mail-1' }));
    const sendTelegram = vi.fn(async () => ({ providerId: 'telegram-message-1' }));
    const processor = new NotificationDeliveryProcessor({
      repository,
      publicBaseUrl: 'https://openqareer.test',
      resolveEmail: async (candidateId) =>
        candidateId === 'candidate-a' ? 'candidate@example.test' : null,
      createUnsubscribeUrl: async () => 'https://openqareer.test/unsubscribe?token=opaque',
      sendEmail,
      sendTelegram,
    });

    const first = await processor.processDue(NOW);
    const second = await processor.processDue(NOW);

    expect(first).toEqual({ claimed: 2, delivered: 2, failed: 0, skipped: 0 });
    expect(second.claimed).toBe(0);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'candidate@example.test',
        idempotencyKey: expect.stringMatching(/^notification-email\//u),
        unsubscribeUrl: 'https://openqareer.test/unsubscribe?token=opaque',
      }),
    );
    expect(sendTelegram).toHaveBeenCalledWith(expect.objectContaining({ chatId: '100' }));
  });

  it('retries transient provider errors and skips a channel turned off before delivery', async () => {
    const repository = createRepository();
    addReply(repository);
    const sendEmail = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider timeout'))
      .mockResolvedValue({ providerId: 'mail-2' });
    const sendTelegram = vi.fn(async () => ({ providerId: 'telegram-message-2' }));
    const processor = new NotificationDeliveryProcessor({
      repository,
      publicBaseUrl: 'https://openqareer.test',
      resolveEmail: async () => 'candidate@example.test',
      createUnsubscribeUrl: async () => 'https://openqareer.test/unsubscribe?token=opaque',
      sendEmail,
      sendTelegram,
    });

    const failed = await processor.processDue(NOW);
    repository.setPreference(
      'candidate-a',
      'ev-reply',
      { app: false, email: true, telegram: false },
      NOW,
    );
    const retried = await processor.processDue('2026-10-11T12:02:00.000Z');

    expect(failed).toMatchObject({ failed: 1, delivered: 1 });
    expect(retried).toMatchObject({ claimed: 1, delivered: 1, skipped: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendTelegram).toHaveBeenCalledTimes(1);
  });
});
