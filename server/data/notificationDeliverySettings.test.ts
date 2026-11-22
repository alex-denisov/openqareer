import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SealedText } from './sealedText';
import { SqliteNotificationRepository } from './sqliteNotificationRepository';

const NOW = '2026-11-20T10:00:00.000Z';
const cleanup: (() => void)[] = [];

afterEach(() => cleanup.splice(0).forEach((close) => close()));

function createRepository(): { repository: SqliteNotificationRepository; database: DatabaseSync } {
  const database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
  database.prepare('INSERT INTO candidates (id) VALUES (?)').run('candidate-a');
  const repository = new SqliteNotificationRepository(database, new SealedText(Buffer.alloc(32, 4)));
  cleanup.push(() => repository.close(), () => database.close());
  return { repository, database };
}

describe('n02: «Как часто» и «Не показывать название компании»', () => {
  it('пока кандидат не выбирал — сразу и с названием компании', () => {
    const { repository } = createRepository();
    expect(repository.getDeliverySettings('candidate-a')).toEqual({
      frequency: 'immediate',
      hideCompany: false,
    });
  });

  it('сохраняет выбор кандидата', () => {
    const { repository } = createRepository();
    const saved = repository.setDeliverySettings(
      'candidate-a',
      { frequency: 'weekly', hideCompany: true },
      NOW,
    );
    expect(saved).toEqual({ frequency: 'weekly', hideCompany: true });
    expect(repository.getDeliverySettings('candidate-a')).toEqual(saved);
  });

  it('отложенная до сводки доставка не тратит попытку и приходит в срок сводки', () => {
    const { repository } = createRepository();
    repository.setPreference('candidate-a', 'ev-reply', { app: true, email: true, telegram: false }, NOW);
    const recorded = repository.recordEvent(
      'candidate-a',
      { idempotencyKey: 'r1', kind: 'employer_reply', sourceType: 'application', sourceId: 'a1', createdAt: NOW },
      NOW,
    );
    const [claimed] = repository.claimDueDeliveries(NOW, 10);
    repository.deferDelivery('candidate-a', recorded!.id, 'email', '2026-11-21T06:00:00.000Z', NOW);

    expect(repository.claimDueDeliveries('2026-11-21T05:59:00.000Z', 10)).toEqual([]);
    const [due] = repository.claimDueDeliveries('2026-11-21T06:00:00.000Z', 10);
    expect(due).toMatchObject({ notificationId: recorded!.id, channel: 'email', attempt: claimed!.attempt });
  });
});
