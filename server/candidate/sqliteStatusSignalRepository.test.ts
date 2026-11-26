import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteStatusSignalRepository } from './sqliteStatusSignalRepository';

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function setup() {
  const database = new DatabaseSync(':memory:');
  database.exec(
    "PRAGMA foreign_keys = ON; CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT; INSERT INTO candidates VALUES ('alice'), ('bob');",
  );
  databases.push(database);
  return { database, repository: new SqliteStatusSignalRepository(database) };
}

const answer = (id: string, createdAt: string, candidateId = 'alice') => ({
  id,
  candidateId,
  kind: 'started_search' as const,
  answer: 'no' as const,
  createdAt,
  undoUntil: '2026-11-16T21:00:00.000Z',
});

describe('SqliteStatusSignalRepository', () => {
  it('хранит ответы кандидата, новые первыми, чужих не отдаёт', () => {
    const { repository } = setup();
    repository.record(answer('a1', '2026-11-01T10:00:00.000Z'));
    repository.record(answer('a2', '2026-11-16T10:00:00.000Z'));
    repository.record(answer('b1', '2026-11-16T11:00:00.000Z', 'bob'));
    expect(repository.active('alice').map((item) => item.id)).toEqual(['a2', 'a1']);
    expect(repository.active('bob').map((item) => item.id)).toEqual(['b1']);
  });

  it('отменённый ответ больше не действует; отменить можно один раз и только свой', () => {
    const { repository } = setup();
    repository.record(answer('a1', '2026-11-16T10:00:00.000Z'));
    expect(repository.markUndone('bob', 'a1', '2026-11-16T10:05:00.000Z')).toBe(false);
    expect(repository.markUndone('alice', 'a1', '2026-11-16T10:05:00.000Z')).toBe(true);
    expect(repository.markUndone('alice', 'a1', '2026-11-16T10:06:00.000Z')).toBe(false);
    expect(repository.active('alice')).toEqual([]);
  });

  it('давние «Нет» не теряются за сотней «Не сейчас»', () => {
    const { repository } = setup();
    repository.record(answer('no-1', '2026-01-01T10:00:00.000Z'));
    repository.record(answer('no-2', '2026-02-01T10:00:00.000Z'));
    for (let day = 0; day < 120; day += 1) {
      const createdAt = new Date(Date.UTC(2026, 2, 1 + day, 10)).toISOString();
      repository.record({ ...answer(`later-${day}`, createdAt), answer: 'later' });
    }
    const active = repository.active('alice');
    expect(active.filter((item) => item.answer === 'no').map((item) => item.id)).toEqual([
      'no-2',
      'no-1',
    ]);
    expect(active.filter((item) => item.answer === 'later')).toHaveLength(50);
    expect(active[0].id).toBe('later-119');
  });

  it('отклоняет неизвестный сигнал и ответ', () => {
    const { repository } = setup();
    expect(() =>
      repository.record({ ...answer('x', '2026-11-16T10:00:00.000Z'), kind: 'other' as never }),
    ).toThrow();
    expect(() =>
      repository.record({ ...answer('y', '2026-11-16T10:00:00.000Z'), answer: 'maybe' as never }),
    ).toThrow();
  });

  it('ответы уходят вместе с кандидатом', () => {
    const { database, repository } = setup();
    repository.record(answer('a1', '2026-11-16T10:00:00.000Z'));
    database.exec("DELETE FROM candidates WHERE id = 'alice'");
    expect(repository.active('alice')).toEqual([]);
  });

  it('создание таблицы повторяемо', () => {
    const { database } = setup();
    expect(() => new SqliteStatusSignalRepository(database)).not.toThrow();
  });
});
