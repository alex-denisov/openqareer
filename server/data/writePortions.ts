import type { DatabaseSync } from 'node:sqlite';

export function inWriteTransaction(database: DatabaseSync, work: () => void): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    work();
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
}

/** Короткие транзакции по `portion` строк; `pause` между ними пускает другого писателя. */
export function writeInPortions<T>(
  database: DatabaseSync,
  rows: readonly T[],
  portion: number,
  pause: () => void,
  write: (row: T) => void,
): void {
  for (let start = 0; start < rows.length; start += portion) {
    if (start > 0) pause();
    const slice = rows.slice(start, start + portion);
    inWriteTransaction(database, () => slice.forEach(write));
  }
}
