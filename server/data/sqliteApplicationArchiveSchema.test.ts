import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATION_33, MIGRATION_38 } from './sqliteSchema';

describe('application archive schema migration', () => {
  it('adds nullable archive metadata while preserving existing rows', () => {
    const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
    database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
    database.exec(MIGRATION_33);
    database.prepare("INSERT INTO candidates (id) VALUES ('candidate-1')").run();
    database
      .prepare(
        `INSERT INTO applications
          (id, candidate_id, stage, stage_changed_at, created_at, updated_at)
         VALUES ('app-1', 'candidate-1', 'archived', 'old', 'old', 'old')`,
      )
      .run();

    database.exec(MIGRATION_38);

    const columns = database.prepare('PRAGMA table_info(applications)').all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    expect(columns.find((column) => column.name === 'archive_reason')).toMatchObject({
      type: 'TEXT',
      notnull: 0,
      dflt_value: 'NULL',
    });
    expect(columns.find((column) => column.name === 'archive_previous_stage')).toMatchObject({
      type: 'TEXT',
      notnull: 0,
      dflt_value: 'NULL',
    });
    expect(
      database
        .prepare('SELECT stage, archive_reason, archive_previous_stage FROM applications WHERE id = ?')
        .get('app-1'),
    ).toEqual({ stage: 'archived', archive_reason: null, archive_previous_stage: null });
    database.close();
  });

  it('uses only nullable ADD COLUMN statements for large-database startup safety', () => {
    const statements = MIGRATION_38.split(';').map((statement) => statement.trim()).filter(Boolean);
    expect(statements).toEqual([
      'ALTER TABLE applications ADD COLUMN archive_reason TEXT DEFAULT NULL',
      'ALTER TABLE applications ADD COLUMN archive_previous_stage TEXT DEFAULT NULL',
    ]);
  });
});
