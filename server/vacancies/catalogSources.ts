/**
 * CPO 26.10: фильтр «Источники» знал только реестр площадок (24) и источники
 * текущей подборки — 35 из 322 живых источников пула. Полный список считает
 * процесс обслуживания (GROUP BY по индексу пула), веб читает одну таблицу в
 * фоне и держит её в памяти: HTTP пул не трогает (B308).
 */
import type { DatabaseSync } from 'node:sqlite';
import { syncSection } from '../observability/syncSections';
import { nextTurn, readRowsChunked } from '../data/chunkedRows';
import { readInWindows, type WindowedReadOptions } from '../data/windowedRead';

export interface CatalogSourceCount {
  readonly sourceId: string;
  readonly count: number;
}

const CATALOG_SOURCES_TABLE = `
CREATE TABLE IF NOT EXISTS catalog_sources (
  source_id TEXT PRIMARY KEY,
  vacancy_count INTEGER NOT NULL,
  computed_at TEXT NOT NULL
) STRICT;
`;

export interface PoolCounts {
  readonly active: number;
  readonly remote: number;
  readonly bySource: ReadonlyMap<string, number>;
}

/**
 * B776: живые записи пула по источникам — один проход окнами rowid вместо двух
 * сплошных просмотров (подсчёт лендинга 137 с на проде 23.11, GROUP BY — столько же).
 */
export function readPoolCounts(
  database: DatabaseSync,
  options: WindowedReadOptions = {},
): PoolCounts {
  const bySource = new Map<string, number>();
  let active = 0;
  let remote = 0;
  readInWindows<{ source_id: string; n: number; remote: number | null }>(
    database,
    {
      table: 'vacancy_pool_index',
      sql: `SELECT source_id, count(*) AS n, sum(is_remote = 1) AS remote
              FROM vacancy_pool_index NOT INDEXED
             WHERE rowid > ? AND rowid <= ? AND is_active = 1 AND expired = 0
             GROUP BY source_id`,
    },
    (rows) => {
      for (const row of rows) {
        active += Number(row.n);
        remote += Number(row.remote ?? 0);
        if (row.source_id)
          bySource.set(row.source_id, (bySource.get(row.source_id) ?? 0) + Number(row.n));
      }
    },
    options,
  );
  return { active, remote, bySource };
}

export function catalogSourcesOf(counts: PoolCounts): CatalogSourceCount[] {
  return Array.from(counts.bySource, ([sourceId, count]) => ({ sourceId, count })).sort(
    compareCatalogSources,
  );
}

function compareCatalogSources(left: CatalogSourceCount, right: CatalogSourceCount): number {
  return (
    right.count - left.count ||
    (left.sourceId < right.sourceId ? -1 : left.sourceId > right.sourceId ? 1 : 0)
  );
}

export function computeCatalogSources(
  database: DatabaseSync,
  options: WindowedReadOptions = {},
): CatalogSourceCount[] {
  return catalogSourcesOf(readPoolCounts(database, options));
}

export function writeCatalogSources(
  database: DatabaseSync,
  rows: readonly CatalogSourceCount[],
  now: Date,
): void {
  database.exec(CATALOG_SOURCES_TABLE);
  const insert = database.prepare(
    'INSERT INTO catalog_sources (source_id, vacancy_count, computed_at) VALUES (?, ?, ?)',
  );
  database.exec('BEGIN');
  try {
    database.exec('DELETE FROM catalog_sources');
    for (const row of rows) insert.run(row.sourceId, row.count, now.toISOString());
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

/** B776: 57 696 строк на проде (23.11) читались 0,25 с одним куском — теперь порциями. */
export async function readCatalogSources(database: DatabaseSync): Promise<CatalogSourceCount[]> {
  const exists = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'catalog_sources'")
    .get();
  if (!exists) return [];
  const rows = await readRowsChunked<{ source_id: string; vacancy_count: number }>(
    database.prepare(
      // Sorting in SQL read all 58 thousand rows, off a cold disk, in the first step (B702 part 2).
      'SELECT source_id, vacancy_count FROM catalog_sources ORDER BY rowid',
    ),
  );
  await nextTurn();
  const sources = rows.map((row) => ({ sourceId: row.source_id, count: Number(row.vacancy_count) }));
  return syncSection('catalog-sources:sort', () => sources.sort(compareCatalogSources));
}

let current: readonly CatalogSourceCount[] = [];

export function getCatalogSources(): readonly CatalogSourceCount[] {
  return current;
}

/** Пустой ответ не стирает известный список: таблицу мог ещё не записать процесс обслуживания. */
export function setCatalogSources(next: readonly CatalogSourceCount[]): void {
  if (next.length === 0) return;
  current = next;
}
