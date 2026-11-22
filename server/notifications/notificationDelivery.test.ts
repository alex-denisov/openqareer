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

    expect(first).toEqual({ claimed: 2, delivered: 2, failed: 0, skipped: 0, deferred: 0 });
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

describe('n02: «Как часто» и «Не показывать название компании» в почте и Telegram', () => {
  function reply(repository: SqliteNotificationRepository, key: string, extra: { invitation?: boolean } = {}) {
    return repository.recordEvent(
      'candidate-a',
      { idempotencyKey: key, kind: 'employer_reply', sourceType: 'application', sourceId: `app-${key}`, ...extra },
      NOW,
    );
  }

  function processorFor(repository: SqliteNotificationRepository, company: string | null = 'Ладога Банк') {
    const sendEmail = vi.fn(async (_input: { subject: string; text: string }) => ({ providerId: 'mail' }));
    const sendTelegram = vi.fn(async (_input: { text: string }) => ({ providerId: 'tg' }));
    const processor = new NotificationDeliveryProcessor({
      repository,
      publicBaseUrl: 'https://openqareer.test',
      resolveEmail: () => 'candidate@example.test',
      createUnsubscribeUrl: () => 'https://openqareer.test/unsubscribe?token=opaque',
      resolveCompany: () => company,
      resolveTimeZone: () => 'Europe/Moscow',
      sendEmail,
      sendTelegram,
    });
    return { processor, sendEmail, sendTelegram };
  }

  function setUp(settings: { frequency: 'immediate' | 'daily' | 'weekly'; hideCompany: boolean }) {
    const repository = createRepository();
    repository.setPreference('candidate-a', 'ev-reply', { app: true, email: true, telegram: true }, NOW);
    repository.linkTelegramChat('candidate-a', '100', NOW);
    repository.setDeliverySettings('candidate-a', settings, NOW);
    return repository;
  }

  it('«Сразу»: в письме и Telegram — название компании', async () => {
    const repository = setUp({ frequency: 'immediate', hideCompany: false });
    reply(repository, 'r1');
    const { processor, sendEmail, sendTelegram } = processorFor(repository);
    await processor.processDue(NOW);
    expect(sendEmail.mock.calls[0]![0].text).toContain('Есть ответ работодателя · Ладога Банк');
    expect(sendTelegram.mock.calls[0]![0].text).toContain('Есть ответ работодателя · Ладога Банк');
  });

  it('«Не показывать название компании»: компании нет ни в письме, ни в Telegram', async () => {
    const repository = setUp({ frequency: 'immediate', hideCompany: true });
    reply(repository, 'r1');
    const { processor, sendEmail, sendTelegram } = processorFor(repository);
    await processor.processDue(NOW);
    expect(sendEmail.mock.calls[0]![0].text).not.toContain('Ладога');
    expect(sendTelegram.mock.calls[0]![0].text).not.toContain('Ладога');
    expect(sendTelegram.mock.calls[0]![0].text).toContain('Есть ответ работодателя');
  });

  it('«Раз в день»: ничего не уходит до 09:00, потом одно письмо и одно сообщение на все события', async () => {
    const repository = setUp({ frequency: 'daily', hideCompany: false });
    reply(repository, 'r1');
    reply(repository, 'r2');
    const { processor, sendEmail, sendTelegram } = processorFor(repository);

    const held = await processor.processDue(NOW);
    expect(held).toMatchObject({ claimed: 4, delivered: 0, deferred: 4 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await processor.processDue('2026-10-12T05:59:00.000Z')).toMatchObject({ claimed: 0 });

    const digest = await processor.processDue('2026-10-12T06:00:00.000Z');
    expect(digest).toMatchObject({ claimed: 4, delivered: 4 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    const text = sendEmail.mock.calls[0]![0].text;
    expect(text.match(/Есть ответ работодателя · Ладога Банк/gu)).toHaveLength(2);
    expect(text).toContain('https://openqareer.test/app/notifications');
    expect(sendEmail.mock.calls[0]![0].subject).toBe('Уведомления openqareer за день');
  });

  it('«Раз в неделю»: сводка в понедельник 09:00', async () => {
    const repository = setUp({ frequency: 'weekly', hideCompany: false });
    reply(repository, 'r1');
    const { processor, sendEmail } = processorFor(repository);
    await processor.processDue(NOW); // воскресенье 11.10
    expect(await processor.processDue('2026-10-12T05:59:00.000Z')).toMatchObject({ claimed: 0 });
    await processor.processDue('2026-10-12T06:00:00.000Z');
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('приглашение не ждёт сводки', async () => {
    const repository = setUp({ frequency: 'weekly', hideCompany: false });
    reply(repository, 'invite', { invitation: true });
    const { processor, sendEmail } = processorFor(repository);
    const run = await processor.processDue(NOW);
    expect(run).toMatchObject({ deferred: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe('n02: сводка по поясу из «Приложения»', () => {
  it('«Раз в день» в Тбилиси уходит в 09:00 по Тбилиси', async () => {
    const repository = createRepository();
    repository.setPreference('candidate-a', 'ev-reply', { app: true, email: true, telegram: false }, NOW);
    repository.setDeliverySettings('candidate-a', { frequency: 'daily', hideCompany: false }, NOW);
    repository.recordEvent(
      'candidate-a',
      { idempotencyKey: 'tz', kind: 'employer_reply', sourceType: 'application', sourceId: 'app-tz' },
      NOW,
    );
    const sendEmail = vi.fn(async () => ({ providerId: 'mail' }));
    const processor = new NotificationDeliveryProcessor({
      repository,
      publicBaseUrl: 'https://openqareer.test',
      resolveEmail: () => 'candidate@example.test',
      createUnsubscribeUrl: () => 'https://openqareer.test/unsubscribe?token=opaque',
      resolveTimeZone: () => 'Asia/Tbilisi',
      sendEmail,
    });
    await processor.processDue(NOW);
    expect(await processor.processDue('2026-10-12T04:59:00.000Z')).toMatchObject({ claimed: 0 });
    await processor.processDue('2026-10-12T05:00:00.000Z');
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
