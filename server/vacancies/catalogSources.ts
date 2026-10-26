/**
 * CPO 26.10: фильтр «Источники» знал только реестр площадок (24) и источники
 * текущей подборки — 35 из 322 живых источников пула. Полный список считает
 * процесс обслуживания (GROUP BY по индексу пула), веб читает одну таблицу в
 * фоне и держит её в памяти: HTTP пул не трогает (B308).
 */
import type { DatabaseSync } from 'node:sqlite';

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

export function computeCatalogSources(database: DatabaseSync): CatalogSourceCount[] {
  return (
    database
      .prepare(
        `SELECT source_id, count(*) AS n FROM vacancy_pool_index
         WHERE is_active = 1 AND expired = 0 AND source_id IS NOT NULL
         GROUP BY source_id ORDER BY n DESC, source_id`,
      )
      .all() as { source_id: string; n: number }[]
  ).map((row) => ({ sourceId: row.source_id, count: Number(row.n) }));
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

export function readCatalogSources(database: DatabaseSync): CatalogSourceCount[] {
  const exists = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'catalog_sources'")
    .get();
  if (!exists) return [];
  return (
    database
      .prepare(
        'SELECT source_id, vacancy_count FROM catalog_sources ORDER BY vacancy_count DESC, source_id',
      )
      .all() as { source_id: string; vacancy_count: number }[]
  ).map((row) => ({ sourceId: row.source_id, count: Number(row.vacancy_count) }));
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
