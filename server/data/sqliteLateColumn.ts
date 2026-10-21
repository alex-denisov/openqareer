import type { DatabaseSync } from 'node:sqlite';

/**
 * Adds a column to a small table if it is missing. The HTTP server and the mechanics worker
 * open the stores at the same moment on deploy: the other process may add the column between
 * the check and ALTER, so only `duplicate column name` is benign. ADD COLUMN is a metadata
 * change, not a table rewrite — use it only on tables of a few thousand rows.
 */
export function addLateColumns(database: DatabaseSync, table: string, columns: readonly (readonly [string, string])[]): void {
  const present = new Set((database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name));
  for (const [name, type] of columns) {
    if (present.has(name)) continue;
    try {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    } catch (error) {
      if (!(error instanceof Error && /duplicate column name/iu.test(error.message))) throw error;
    }
  }
}
