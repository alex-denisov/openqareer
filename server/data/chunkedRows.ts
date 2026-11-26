import type { StatementSync } from 'node:sqlite';

/**
 * B776 (прод 23.11): веб-процесс каждые 5 минут читал десятки тысяч строк одним `.all()` —
 * 57 696 строк catalog_sources шли 0,25–0,3 с цикла событий. Порция строк, затем такт.
 */
const DEFAULT_CHUNK = 1_000;

export const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export async function readRowsChunked<T>(statement: StatementSync, chunk = DEFAULT_CHUNK): Promise<T[]> {
  const rows: T[] = [];
  for (const row of statement.iterate()) {
    rows.push(row as T);
    if (rows.length % chunk === 0) await nextTurn();
  }
  return rows;
}
