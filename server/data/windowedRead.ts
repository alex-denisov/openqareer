import { statSync } from 'node:fs';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

/**
 * B776: длинное чтение — окнами по rowid, каждое окно отдельным коротким
 * оператором. Снимок читателя живёт одно окно (~1 с), а не весь проход:
 * landingWrite 23.11 держал один снимок 556 с, контрольная точка не проходила,
 * WAL вырос до 4,6 ГБ (замер на проде: подсчёт пула 137 с, зарплаты 30 с на
 * 20 тыс. строк). Между окнами — сверка размера WAL и короткий зазор.
 */
export const WAL_LIMIT_MB = 1024;
const TARGET_WINDOW_MS = 1_000;
const FIRST_WINDOW_ROWS = 2_000;
const MIN_WINDOW_ROWS = 100;
const MAX_WINDOW_ROWS = 100_000;
const WINDOW_GAP_MS = 10;

export class WalLimitError extends Error {
  constructor(readonly walMb: number) {
    super(`heavy read stopped: WAL ${walMb} MB over ${WAL_LIMIT_MB} MB`);
    this.name = 'WalLimitError';
  }
}

export interface WindowedReadOptions {
  /** Бросает, когда чтение надо прервать; по умолчанию — WAL больше 1024 МБ. */
  readonly guard?: () => void;
  readonly pause?: () => void;
  readonly targetMs?: number;
  readonly firstRows?: number;
}

export interface WindowedQuery {
  readonly table: string;
  /** Оператор с первыми двумя параметрами `rowid > ? AND rowid <= ?`. */
  readonly sql: string;
  readonly params?: readonly SQLInputValue[];
}

/** Сверка WAL рядом с файлом базы; для базы в памяти — ничего. */
export function walLimitGuard(path: string | null, limitMb = WAL_LIMIT_MB): () => void {
  if (!path) return () => undefined;
  return () => {
    let bytes = 0;
    try {
      bytes = statSync(`${path}-wal`).size;
    } catch {
      return; // нет файла WAL — нечему расти
    }
    const walMb = Math.round((bytes / 1_048_576) * 10) / 10;
    if (walMb > limitMb) throw new WalLimitError(walMb);
  };
}

const gapCell = new Int32Array(new SharedArrayBuffer(4));

function sleepGap(): void {
  Atomics.wait(gapCell, 0, 0, WINDOW_GAP_MS);
}

/** Следующий размер окна: держит одно окно около `targetMs`. */
export function nextWindowRows(rows: number, ms: number, targetMs: number): number {
  if (ms > targetMs) return Math.max(MIN_WINDOW_ROWS, Math.floor(rows / 2));
  if (ms < targetMs / 4) return Math.min(MAX_WINDOW_ROWS, rows * 2);
  return rows;
}

function maxRowid(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT coalesce(max(rowid), 0) AS top FROM ${table}`).get() as {
    top: number | bigint;
  };
  return Number(row.top);
}

/** Читает всю таблицу окнами rowid; `onRows` получает строки каждого окна. */
export function readInWindows<T>(
  database: DatabaseSync,
  query: WindowedQuery,
  onRows: (rows: readonly T[]) => void,
  options: WindowedReadOptions = {},
): number {
  const guard = options.guard ?? walLimitGuard(database.location());
  const pause = options.pause ?? sleepGap;
  const targetMs = options.targetMs ?? TARGET_WINDOW_MS;
  const statement = database.prepare(query.sql);
  const top = maxRowid(database, query.table);
  let rows = options.firstRows ?? FIRST_WINDOW_ROWS;
  let after = 0;
  let windows = 0;
  while (after < top) {
    if (windows > 0) pause();
    guard();
    const upTo = Math.min(top, after + rows);
    const startedAt = performance.now();
    const found = statement.all(after, upTo, ...(query.params ?? [])) as unknown as T[];
    rows = nextWindowRows(rows, performance.now() - startedAt, targetMs);
    onRows(found);
    after = upTo;
    windows += 1;
  }
  return windows;
}
