import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATION_33 } from './sqliteSchema';
import { SealedText } from './sealedText';
import { SqliteApplicationOfferRepository } from './sqliteApplicationOfferRepository';

function createRepo() {
  const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
  database.exec(MIGRATION_33);
  database.prepare("INSERT INTO candidates (id) VALUES ('candidate-1')").run();
  database.exec(
    `INSERT INTO applications (id, candidate_id, stage, process_profile, stage_changed_at, created_at, updated_at)
     VALUES ('app-1', 'candidate-1', 'offer', 'standard', '2026-01-01', '2026-01-01', '2026-01-01')`,
  );
  return new SqliteApplicationOfferRepository(database, new SealedText(randomBytes(32)));
}

describe('SqliteApplicationOfferRepository', () => {
  it('stores and reads back sealed offer terms', () => {
    const repo = createRepo();
    repo.put('app-1', { baseSalary: 250_000, currency: 'USD' }, '2026-02-01');
    const offer = repo.get('app-1');
    expect(offer?.terms).toEqual({ baseSalary: 250_000, currency: 'USD' });
    expect(offer?.respondBy).toBe('2026-02-01');
  });

  it('replaces the terms of a renegotiated offer in place', () => {
    const repo = createRepo();
    const first = repo.put('app-1', { baseSalary: 250_000 }, null);
    const second = repo.put('app-1', { baseSalary: 270_000 }, '2026-02-10');
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.terms).toEqual({ baseSalary: 270_000 });
    expect(second.respondBy).toBe('2026-02-10');
  });

  it('returns null when there is no offer yet', () => {
    const repo = createRepo();
    expect(repo.get('app-1')).toBeNull();
  });
});
