import type { DatabaseSync } from 'node:sqlite';

/**
 * Время последней полной чистки пула (B759). Обслуживатель перезапускался на
 * каждом выкате, и каждый старт заново читал пул ~175 с; с отметкой чистка
 * идёт не чаще срока, сколько бы рестартов ни было.
 */
export interface StorePassMark {
  lastFinishedMs(): number | null;
  markFinished(ms: number): void;
}

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS maintenance_store_pass_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  finished_at_ms INTEGER NOT NULL
)`;

export function createStorePassMark(database: DatabaseSync): StorePassMark {
  database.exec(TABLE_SQL);
  const read = database.prepare(
    'SELECT finished_at_ms FROM maintenance_store_pass_state WHERE id = 1',
  );
  const write = database.prepare(
    `INSERT INTO maintenance_store_pass_state (id, finished_at_ms) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET finished_at_ms = excluded.finished_at_ms`,
  );
  return {
    lastFinishedMs: () => {
      const row = read.get() as { finished_at_ms?: number } | undefined;
      return typeof row?.finished_at_ms === 'number' ? row.finished_at_ms : null;
    },
    markFinished: (ms) => {
      write.run(ms);
    },
  };
}
