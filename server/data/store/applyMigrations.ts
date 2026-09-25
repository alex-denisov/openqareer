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
  MIGRATION_19,
  MIGRATION_20,
  MIGRATION_21,
  MIGRATION_24,
  MIGRATION_25,
  MIGRATION_26,
  MIGRATION_28,
  MIGRATION_30,
  MIGRATION_31,
  MIGRATION_32,
  MIGRATION_33,
  MIGRATION_34,
  MIGRATION_35,
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
  MIGRATION_19,
  MIGRATION_20,
  MIGRATION_21,
  // Номер константы (24) больше номера версии: `MIGRATION_22` и `MIGRATION_23`
  // применяют своими соединениями служба входа и хранилище пула вакансий.
  MIGRATION_24,
  MIGRATION_25,
  MIGRATION_26,
  // `MIGRATION_27` применяет своим соединением кэш называния ролей.
  MIGRATION_28,
  // `MIGRATION_29` применяет своим соединением служба согласий.
  MIGRATION_30,
  MIGRATION_31,
  MIGRATION_32,
  MIGRATION_33,
  MIGRATION_34,
  MIGRATION_35,
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
