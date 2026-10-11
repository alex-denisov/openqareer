import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SealedText } from './sealedText';
import { SqliteNotificationRepository } from './sqliteNotificationRepository';
import type { NotificationEventKind } from './notificationPolicy';

const repositories: SqliteNotificationRepository[] = [];
const databases: DatabaseSync[] = [];
const NOW = '2026-10-11T12:00:00.000Z';

afterEach(() => {
  repositories.splice(0).forEach((repository) => repository.close());
  databases.splice(0).forEach((database) => database.close());
});

function createRepository(): SqliteNotificationRepository {
  const database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
  for (const candidateId of ['candidate-a', 'candidate-b', 'candidate-c']) {
    database.prepare('INSERT INTO candidates (id) VALUES (?)').run(candidateId);
  }
  const repository = new SqliteNotificationRepository(database);
  databases.push(database);
  repositories.push(repository);
  return repository;
}

function event(idempotencyKey: string, kind: 'employer_reply' | 'email_approval', createdAt: string) {
  return {
    idempotencyKey,
    kind,
    sourceType: 'application',
    sourceId: `source-${idempotencyKey}`,
    createdAt,
  } as const;
}

describe('SQLite candidate notification repository', () => {
  it('stores idempotently, paginates within a candidate, and marks events read', () => {
    const repository = createRepository();
    const older = repository.recordEvent('candidate-a', event('older', 'employer_reply', '2026-10-10T10:00:00.000Z'));
    const newer = repository.recordEvent('candidate-a', event('newer', 'employer_reply', '2026-10-11T09:00:00.000Z'));
    const duplicate = repository.recordEvent('candidate-a', event('newer', 'employer_reply', '2026-10-11T09:00:00.000Z'));
    repository.recordEvent('candidate-b', event('other', 'employer_reply', '2026-10-11T11:00:00.000Z'));

    const firstPage = repository.list('candidate-a', { limit: 1, now: NOW });
    expect(firstPage.items).toEqual([newer]);
    expect(firstPage.nextCursor).toBeTruthy();
    expect(firstPage.unreadCount).toBe(2);
    expect(duplicate?.id).toBe(newer?.id);
    const secondPage = repository.list('candidate-a', {
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
      now: NOW,
    });
    expect(secondPage.items).toEqual([older]);
    expect(secondPage.nextCursor).toBeNull();
    expect(repository.markRead('candidate-a', older!.id, NOW)).toBe(true);
    expect(repository.list('candidate-a', { limit: 10, now: NOW }).unreadCount).toBe(1);
    expect(repository.markAllRead('candidate-a', NOW)).toBe(1);
    expect(repository.list('candidate-a', { limit: 10, now: NOW }).unreadCount).toBe(0);
    expect(repository.list('candidate-c', { limit: 10, now: NOW }).items).toEqual([]);
    expect(repository.markRead('candidate-a', newer!.id, NOW)).toBe(true);
    expect(repository.markRead('candidate-b', newer!.id, NOW)).toBe(false);
    databases.at(-1)!.prepare('DELETE FROM candidates WHERE id = ?').run('candidate-a');
    expect(repository.list('candidate-a', { limit: 10, now: NOW }).items).toEqual([]);
  });

  it('applies event preferences and physically deletes notifications after 90 days', () => {
    const repository = createRepository();
    const stale = repository.recordEvent(
      'candidate-a',
      event('stale', 'employer_reply', '2026-10-01T00:00:00.000Z'),
      '2026-10-01T00:00:00.000Z',
    );
    expect(stale).not.toBeNull();
    const expiredAt = '2027-01-10T00:00:00.000Z';
    expect(repository.deleteExpired(expiredAt)).toBe(1);
    expect(repository.getPreferences('candidate-a').find((item) => item.key === 'ev-approval'))
      .toMatchObject({ app: true, email: false, telegram: false });
    repository.setPreference('candidate-a', 'ev-approval', { app: false, email: true }, NOW);
    expect(repository.recordEvent('candidate-a', event('disabled', 'email_approval', NOW))).not.toBeNull();
    expect(repository.list('candidate-a', { limit: 10, now: expiredAt })).toMatchObject({
      items: [],
      unreadCount: 0,
      nextCursor: null,
    });
  });

  it('builds a safe internal action for each supported event kind without storing free text', () => {
    const repository = createRepository();
    const kinds: readonly NotificationEventKind[] = [
      'email_approval', 'post_approval', 'interview_reminder', 'new_vacancies_by_role',
      'employer_opened_letter', 'consultant_edits', 'footprint_findings', 'import_completed',
      'employer_reply', 'delivery_error',
    ];
    const items = kinds.map((kind) => repository.recordEvent('candidate-a', {
      idempotencyKey: `action:${kind}`,
      kind,
      sourceType: 'test_source',
      sourceId: `source-${kind}`,
      createdAt: NOW,
    })!);

    expect(items).toHaveLength(10);
    for (const item of items) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.action.href).toMatch(/^\/app\?/u);
      expect(item.action.href).not.toMatch(/^https?:/u);
    }
  });

  it('queues selected email and Telegram once while hiding app-disabled events', () => {
    const database = new DatabaseSync(':memory:');
    database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
    database.prepare('INSERT INTO candidates (id) VALUES (?)').run('candidate-a');
    const repository = new SqliteNotificationRepository(database, new SealedText(Buffer.alloc(32, 4)));
    databases.push(database);
    repositories.push(repository);
    repository.setPreference('candidate-a', 'ev-reply', { app: false, email: true, telegram: true }, NOW);
    repository.linkTelegramChat('candidate-a', '100', NOW);
    const input = event('outbox-once', 'employer_reply', NOW);
    const first = repository.recordEvent('candidate-a', input, NOW);
    const replay = repository.recordEvent('candidate-a', input, NOW);

    expect(first?.id).toBe(replay?.id);
    expect(repository.list('candidate-a', { limit: 10, now: NOW }).items).toEqual([]);
    expect(repository.claimDueDeliveries(NOW, 10)).toMatchObject([
      { notificationId: first?.id, candidateId: 'candidate-a', channel: 'email' },
      { notificationId: first?.id, candidateId: 'candidate-a', channel: 'telegram' },
    ]);
    expect(repository.getTelegramChat('candidate-a')).toBe('100');
  });

  it('consumes a Telegram code once and encrypts the chat id at rest', () => {
    const database = new DatabaseSync(':memory:');
    database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
    database.prepare('INSERT INTO candidates (id) VALUES (?)').run('candidate-a');
    const repository = new SqliteNotificationRepository(database, new SealedText(Buffer.alloc(32, 4)));
    databases.push(database);
    repositories.push(repository);
    const codeHash = 'c'.repeat(64);
    repository.createTelegramLinkCode('candidate-a', codeHash, '2026-10-11T12:10:00.000Z', NOW);

    expect(repository.consumeTelegramLinkCode(codeHash, '987654321', NOW)).toBe('candidate-a');
    expect(repository.consumeTelegramLinkCode(codeHash, '987654321', NOW)).toBeNull();
    expect(repository.getTelegramLinkStatus('candidate-a').connected).toBe(true);
    const stored = database.prepare(
      'SELECT chat_id_cipher FROM candidate_notification_telegram_chats WHERE candidate_id = ?',
    ).get('candidate-a') as { chat_id_cipher: string };
    expect(stored.chat_id_cipher).not.toContain('987654321');
    const reopened = new SqliteNotificationRepository(database, new SealedText(Buffer.alloc(32, 4)));
    repositories.push(reopened);
    expect(reopened.getTelegramLinkStatus('candidate-a').connected).toBe(true);
  });
});
