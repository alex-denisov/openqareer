import type { DatabaseSync } from 'node:sqlite';
import {
  MIGRATION_1,
  MIGRATION_2,
  MIGRATION_3,
  MIGRATION_4,
  MIGRATION_5,
  MIGRATION_6,
  MIGRATION_7,
  MIGRATION_8,
  MIGRATION_9,
  MIGRATION_10,
  MIGRATION_11,
  MIGRATION_12,
  MIGRATION_13,
  MIGRATION_14,
  MIGRATION_15,
  MIGRATION_16,
  MIGRATION_17,
  MIGRATION_18,
} from '../sqliteSchema';

const MIGRATIONS = [
  MIGRATION_1,
  MIGRATION_2,
  MIGRATION_3,
  MIGRATION_4,
  MIGRATION_5,
  MIGRATION_6,
  MIGRATION_7,
  MIGRATION_8,
  MIGRATION_9,
  MIGRATION_10,
  MIGRATION_11,
  MIGRATION_12,
  MIGRATION_13,
  MIGRATION_14,
  MIGRATION_15,
  MIGRATION_16,
  MIGRATION_17,
  MIGRATION_18,
];

export function applyMigrations(
  database: DatabaseSync,
  inTransaction: (operation: () => void) => void,
): void {
  database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
  const row = database
    .prepare('SELECT MAX(version) AS version FROM schema_migrations')
    .get() as { version: number | null };
  MIGRATIONS.forEach((migration, index) => {
    const version = index + 1;
    if ((row.version ?? 0) < version) {
      inTransaction(() => {
        database.exec(migration);
        database
          .prepare(
            'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
          )
          .run(version, new Date().toISOString());
      });
    }
  });
}
