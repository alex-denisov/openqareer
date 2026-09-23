import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATION_33 } from './sqliteSchema';
import { SqliteApplicationMaterialsRepository } from './sqliteApplicationMaterialsRepository';

function createRepo() {
  const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
  database.exec(MIGRATION_33);
  database.prepare("INSERT INTO candidates (id) VALUES ('candidate-1')").run();
  database.exec(
    `INSERT INTO applications (id, candidate_id, stage, process_profile, stage_changed_at, created_at, updated_at)
     VALUES ('app-1', 'candidate-1', 'saved', 'standard', '2026-01-01', '2026-01-01', '2026-01-01')`,
  );
  return new SqliteApplicationMaterialsRepository(database);
}

describe('SqliteApplicationMaterialsRepository', () => {
  it('links a document to a role', () => {
    const repo = createRepo();
    repo.link('app-1', 'cover_letter', 'doc-1');
    expect(repo.list('app-1')).toEqual([
      { role: 'cover_letter', documentId: 'doc-1', linkedAt: expect.any(String) },
    ]);
  });

  it('replaces the current document for a role instead of adding a second row', () => {
    const repo = createRepo();
    repo.link('app-1', 'cover_letter', 'doc-1');
    repo.link('app-1', 'cover_letter', 'doc-2');
    const materials = repo.list('app-1');
    expect(materials).toHaveLength(1);
    expect(materials[0].documentId).toBe('doc-2');
  });

  it('keeps resume and cover letter as separate rows', () => {
    const repo = createRepo();
    repo.link('app-1', 'cover_letter', 'doc-1');
    repo.link('app-1', 'resume', 'doc-2');
    expect(repo.list('app-1')).toHaveLength(2);
  });
});
