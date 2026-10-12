import type { DatabaseSync } from 'node:sqlite';

/** Join a parent write or run the operation atomically on the same SQLite connection. */
export function runSqliteTransaction<T>(database: DatabaseSync, operation: () => T): T {
  if (database.isTransaction) return operation();
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
