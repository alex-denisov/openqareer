/**
 * B649-5: запись итогов лендинга порциями. До этого главный поток получал всю
 * структуру из потока (~50 тыс. источников, зарплаты, фишки) и писал каждую
 * таблицу одной транзакцией «DELETE всё + INSERT» — перед двумя heap OOM 14–15.11.
 * Теперь пишет сам поток своим соединением-писателем: замена по ключу
 * короткими транзакциями, затем порционное удаление строк прошлого расчёта.
 */
import type { DatabaseSync } from 'node:sqlite';
import { pauseClusterWrite } from '../vacancies/clusterWritePause';
import { computeCatalogSources } from '../vacancies/catalogSources';
import { computeCatalogSalaryStats } from '../vacancies/catalogSalaryStatsStore';
import { computeCatalogChips, writeCatalogChips } from '../vacancies/catalogChipStore';
import { computeLandingStats, writeLandingStats } from './landingStatsJob';

export const LANDING_WRITE_PORTION = 1_000;

export interface KeyedTable {
  readonly table: 'catalog_sources' | 'catalog_salary_stats';
  readonly keyColumn: string;
  readonly valueColumn: string;
}

export interface PortionOptions {
  readonly portion?: number;
  readonly pause?: () => void;
  readonly onPortion?: (size: number) => void;
}

export interface PortionReport {
  readonly written: number;
  readonly removed: number;
  readonly transactions: number;
}

function inTransaction(database: DatabaseSync, work: () => void): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    work();
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
}

/** Таблица остаётся читаемой всё время: старые строки уходят только в конце. */
export function replaceKeyedRowsInPortions(
  database: DatabaseSync,
  { table, keyColumn, valueColumn }: KeyedTable,
  rows: ReadonlyArray<readonly [string, string | number]>,
  computedAt: string,
  { portion = LANDING_WRITE_PORTION, pause = pauseClusterWrite, onPortion }: PortionOptions = {},
): PortionReport {
  const upsert = database.prepare(
    `INSERT INTO ${table} (${keyColumn}, ${valueColumn}, computed_at) VALUES (?, ?, ?)
     ON CONFLICT(${keyColumn}) DO UPDATE SET ${valueColumn} = excluded.${valueColumn},
       computed_at = excluded.computed_at`,
  );
  const prune = database.prepare(
    `DELETE FROM ${table} WHERE rowid IN
       (SELECT rowid FROM ${table} WHERE computed_at <> ? LIMIT ?)`,
  );
  let transactions = 0;
  for (let start = 0; start < rows.length; start += portion) {
    if (transactions > 0) pause();
    const slice = rows.slice(start, start + portion);
    inTransaction(database, () => {
      for (const [key, value] of slice) upsert.run(key, value, computedAt);
    });
    onPortion?.(slice.length);
    transactions += 1;
  }
  let removed = 0;
  for (;;) {
    if (transactions > 0) pause();
    let changes = 0;
    inTransaction(database, () => {
      changes = Number(prune.run(computedAt, portion).changes);
    });
    transactions += 1;
    removed += changes;
    if (changes < portion) break;
  }
  return { written: rows.length, removed, transactions };
}

const SOURCES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS catalog_sources (
  source_id TEXT PRIMARY KEY, vacancy_count INTEGER NOT NULL, computed_at TEXT NOT NULL) STRICT`;
const SALARY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS catalog_salary_stats (
  list_key TEXT PRIMARY KEY, payload TEXT NOT NULL, computed_at TEXT NOT NULL) STRICT`;

export interface LandingWriteSummary {
  readonly active: number;
  readonly rows: number;
  readonly sources: PortionReport;
  readonly salaryStats: PortionReport;
  readonly chips: Record<string, number>;
}

/**
 * Считает на `reader`, пишет на `writer` (в потоке это два соединения: снимок
 * читателя закрыт до записи). Наружу — только сводка для журнала.
 */
export function computeAndWriteLanding(
  reader: DatabaseSync,
  openWriter: () => DatabaseSync,
  nowMs: number,
  closeReader: () => void = () => undefined,
): LandingWriteSummary {
  const now = new Date(nowMs);
  const landing = computeLandingStats(reader, now);
  const sources = computeCatalogSources(reader);
  const salary = computeCatalogSalaryStats(reader);
  const chips = computeCatalogChips(reader, nowMs);
  closeReader();
  const writer = openWriter();
  const computedAt = now.toISOString();
  writeLandingStats(writer, landing, now);
  writer.exec(SOURCES_TABLE_SQL);
  writer.exec(SALARY_TABLE_SQL);
  const sourcesReport = replaceKeyedRowsInPortions(
    writer,
    { table: 'catalog_sources', keyColumn: 'source_id', valueColumn: 'vacancy_count' },
    sources.map((row) => [row.sourceId, row.count] as const),
    computedAt,
  );
  const salaryReport = replaceKeyedRowsInPortions(
    writer,
    { table: 'catalog_salary_stats', keyColumn: 'list_key', valueColumn: 'payload' },
    [...salary].map(([key, value]) => [key, JSON.stringify(value)] as const),
    computedAt,
  );
  const chipsReport = writeCatalogChips(writer, chips, now);
  return {
    active: landing.activeCount,
    rows: landing.vacancies.length,
    sources: sourcesReport,
    salaryStats: salaryReport,
    chips: { ...chipsReport },
  };
}
