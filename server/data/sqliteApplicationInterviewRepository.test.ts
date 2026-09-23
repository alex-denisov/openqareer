import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATION_33 } from './sqliteSchema';
import { SealedText } from './sealedText';
import { SqliteApplicationInterviewRepository } from './sqliteApplicationInterviewRepository';

function createRepo() {
  const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
  database.exec(MIGRATION_33);
  database.prepare("INSERT INTO candidates (id) VALUES ('candidate-1')").run();
  database.exec(
    `INSERT INTO applications (id, candidate_id, stage, process_profile, stage_changed_at, created_at, updated_at)
     VALUES ('app-1', 'candidate-1', 'interview', 'standard', '2026-01-01', '2026-01-01', '2026-01-01')`,
  );
  return new SqliteApplicationInterviewRepository(database, new SealedText(randomBytes(32)));
}

describe('SqliteApplicationInterviewRepository', () => {
  it('creates a round with no prep by default', () => {
    const repo = createRepo();
    const created = repo.create('app-1', { round: 1, scheduledAt: '2026-02-01T10:00:00Z', format: 'video' });
    expect(created.prepStatus).toBe('none');
    expect(created.prep).toBeNull();
  });

  it('patches prep text and marks it ready, sealed at rest and readable back', () => {
    const repo = createRepo();
    const created = repo.create('app-1', { round: 1 });
    const patched = repo.patch('app-1', created.id, { prepStatus: 'ready', prep: 'STAR stories x3' });
    expect(patched?.prepStatus).toBe('ready');
    expect(patched?.prep).toBe('STAR stories x3');
  });

  it('adds a debrief after the interview happened', () => {
    const repo = createRepo();
    const created = repo.create('app-1', { round: 2 });
    const patched = repo.patch('app-1', created.id, { debrief: 'went well, awaiting next round' });
    expect(patched?.debrief).toBe('went well, awaiting next round');
  });

  it('returns null when patching an unknown interview', () => {
    const repo = createRepo();
    expect(repo.patch('app-1', 'missing', { prepStatus: 'ready' })).toBeNull();
  });

  it('lists interviews ordered by scheduled time', () => {
    const repo = createRepo();
    repo.create('app-1', { round: 2, scheduledAt: '2026-03-01T00:00:00Z' });
    repo.create('app-1', { round: 1, scheduledAt: '2026-02-01T00:00:00Z' });
    const list = repo.list('app-1');
    expect(list.map((i) => i.round)).toEqual([1, 2]);
  });
});
