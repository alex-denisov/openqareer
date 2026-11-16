import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteCandidateStatusRepository } from './sqliteCandidateStatusRepository';

const key = Buffer.alloc(32, 7);
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function setup() {
  const database = new DatabaseSync(':memory:');
  database.exec(
    "CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT; INSERT INTO candidates VALUES ('alice'), ('bob');",
  );
  databases.push(database);
  return { database, repository: new SqliteCandidateStatusRepository(database, key) };
}

function change(id: string, status: 'looking' | 'job_search' | 'changing_profession' | 'working', createdAt: string) {
  return {
    id,
    candidateId: 'alice',
    status,
    targetProfession: status === 'changing_profession' ? 'продакт-менеджер' : null,
    previousStatus: 'job_search' as const,
    previousTargetProfession: null,
    applied: { autoApplyPause: null },
    createdAt,
    revertUntil: '2026-11-16T21:00:00.000Z',
  };
}

describe('SqliteCandidateStatusRepository', () => {
  it('has no current status until the candidate chooses one', () => {
    const { repository } = setup();
    expect(repository.current('alice')).toBeNull();
    expect(repository.history('alice')).toEqual([]);
  });

  it('keeps the latest change as current and lists history newest first', () => {
    const { repository } = setup();
    repository.record(change('c1', 'looking', '2026-10-02T10:00:00.000Z'));
    repository.record(change('c2', 'changing_profession', '2026-11-10T10:00:00.000Z'));
    expect(repository.current('alice')).toMatchObject({
      id: 'c2',
      status: 'changing_profession',
      targetProfession: 'продакт-менеджер',
      revertedAt: null,
    });
    expect(repository.history('alice').map((item) => item.id)).toEqual(['c2', 'c1']);
    expect(repository.current('bob')).toBeNull();
  });

  it('stores the named profession sealed, not as plain text', () => {
    const { database, repository } = setup();
    repository.record(change('c1', 'changing_profession', '2026-11-10T10:00:00.000Z'));
    const row = database.prepare('SELECT * FROM candidate_status_changes').get() as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain('продакт');
  });

  it('keeps the applied settings snapshot for «Вернуть прежний»', () => {
    const { repository } = setup();
    const applied = {
      autoApplyPause: {
        appliedUntil: '2027-11-16T10:00:00.000Z',
        previousPausedUntil: null,
        previousRuntime: { status: 'ready', pauseUntil: null, nextSendAt: null },
        wasPaused: false,
      },
    };
    repository.record({ ...change('c1', 'working', '2026-11-16T10:00:00.000Z'), applied });
    expect(repository.current('alice')?.applied).toEqual(applied);
  });

  it('drops a reverted change from current and history', () => {
    const { repository } = setup();
    repository.record(change('c1', 'looking', '2026-10-02T10:00:00.000Z'));
    repository.record(change('c2', 'working', '2026-11-16T10:00:00.000Z'));
    expect(repository.markReverted('alice', 'c2', '2026-11-16T11:00:00.000Z')).toBe(true);
    expect(repository.markReverted('alice', 'c2', '2026-11-16T12:00:00.000Z')).toBe(false);
    expect(repository.markReverted('bob', 'c1', '2026-11-16T12:00:00.000Z')).toBe(false);
    expect(repository.current('alice')?.id).toBe('c1');
    expect(repository.history('alice').map((item) => item.id)).toEqual(['c1']);
  });

  it('removes the history together with the candidate', () => {
    const { database, repository } = setup();
    repository.record(change('c1', 'looking', '2026-10-02T10:00:00.000Z'));
    database.exec("DELETE FROM candidates WHERE id = 'alice'");
    expect(repository.history('alice')).toEqual([]);
  });
});
