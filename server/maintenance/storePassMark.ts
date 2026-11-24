import type { DatabaseSync } from 'node:sqlite';
import { isStorePassStep, type StorePassProgress } from '../vacancies/storePassSteps';

/**
 * Время последней полной чистки пула (B759). Обслуживатель перезапускался на
 * каждом выкате, и каждый старт заново читал пул ~175 с; с отметкой чистка
 * идёт не чаще срока, сколько бы рестартов ни было.
 */
export interface StorePassMark {
  lastFinishedMs(): number | null;
  /** Отметка законченного прохода; прогресс незаконченного стирается. */
  markFinished(ms: number): void;
  /** Незаконченный проход: шаг и позиция, с которых продолжить после рестарта. */
  progress(): StorePassProgress | null;
  saveProgress(progress: StorePassProgress): void;
}

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS maintenance_store_pass_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  finished_at_ms INTEGER NOT NULL
)`;

const PROGRESS_SQL = `CREATE TABLE IF NOT EXISTS maintenance_store_pass_progress (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  step TEXT NOT NULL,
  backfill_cursor INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
)`;

function progressStatements(database: DatabaseSync) {
  database.exec(PROGRESS_SQL);
  return {
    read: database.prepare(
      'SELECT step, backfill_cursor FROM maintenance_store_pass_progress WHERE id = 1',
    ),
    write: database.prepare(
      `INSERT INTO maintenance_store_pass_progress (id, step, backfill_cursor, updated_at_ms)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET step = excluded.step,
         backfill_cursor = excluded.backfill_cursor, updated_at_ms = excluded.updated_at_ms`,
    ),
    clear: database.prepare('DELETE FROM maintenance_store_pass_progress WHERE id = 1'),
  };
}

export function createStorePassMark(database: DatabaseSync): StorePassMark {
  database.exec(TABLE_SQL);
  const progress = progressStatements(database);
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
      progress.clear.run();
    },
    progress: () => {
      const row = progress.read.get() as { step?: unknown; backfill_cursor?: unknown } | undefined;
      if (!row || !isStorePassStep(row.step)) return null;
      const cursor = typeof row.backfill_cursor === 'number' ? row.backfill_cursor : 0;
      return { step: row.step, backfillCursor: cursor };
    },
    saveProgress: (next) => {
      progress.write.run(next.step, next.backfillCursor, Date.now());
    },
  };
}
