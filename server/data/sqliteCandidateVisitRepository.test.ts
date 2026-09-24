import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATION_33 } from './sqliteSchema';
import { SqliteCandidateVisitRepository } from './sqliteCandidateVisitRepository';

function createRepo() {
  const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
  database.exec(MIGRATION_33);
  database.prepare("INSERT INTO candidates (id) VALUES ('candidate-1')").run();
  return new SqliteCandidateVisitRepository(database);
}

describe('SqliteCandidateVisitRepository', () => {
  it('records the first visit and reports no previous visit', () => {
    const repo = createRepo();
    const result = repo.recordVisit('candidate-1', '2026-09-24T10:00:00.000Z');
    expect(result.since).toBeNull();
  });

  it('does not move the mark when less than 30 minutes passed', () => {
    const repo = createRepo();
    repo.recordVisit('candidate-1', '2026-09-24T10:00:00.000Z');
    const result = repo.recordVisit('candidate-1', '2026-09-24T10:29:59.000Z');
    // The mark did not move, so "since" still reports the first visit.
    expect(result.since).toBe('2026-09-24T10:00:00.000Z');
  });

  it('moves the mark once at least 30 minutes passed', () => {
    const repo = createRepo();
    repo.recordVisit('candidate-1', '2026-09-24T10:00:00.000Z');
    const result = repo.recordVisit('candidate-1', '2026-09-24T10:30:00.000Z');
    expect(result.since).toBe('2026-09-24T10:00:00.000Z');

    const third = repo.recordVisit('candidate-1', '2026-09-24T10:31:00.000Z');
    // The mark moved on the previous call, so "since" now reports that visit.
    expect(third.since).toBe('2026-09-24T10:30:00.000Z');
  });

  it('reads the last visit without recording a new one', () => {
    const repo = createRepo();
    expect(repo.getSinceLastVisit('candidate-1')).toBeNull();
    repo.recordVisit('candidate-1', '2026-09-24T10:00:00.000Z');
    expect(repo.getSinceLastVisit('candidate-1')).toBe('2026-09-24T10:00:00.000Z');
  });
});
