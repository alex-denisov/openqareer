/**
 * B649-3: тяжёлые чтения обслуживания, которые держали цикл событий
 * (прод 12–13.11: лендинг 117–160 с, зарплатные снимки 789 с, карты сайта ~40 с).
 * Каждое — чистое чтение; запись остаётся у соединения-писателя.
 */
import { DatabaseSync } from 'node:sqlite';
import { computeLandingStats } from '../../landing/landingStatsJob';
import { computeCatalogSources } from '../../vacancies/catalogSources';
import { computeCatalogSalaryStats } from '../../vacancies/catalogSalaryStatsStore';
import { computeCatalogChips } from '../../vacancies/catalogChipStore';
import { computeSalaryMarketSnapshots } from '../../salaryMarket/salaryMarketSnapshot';
import { computeCatalogSitemaps } from '../../seo/catalogSitemapJob';

export interface HeavyReadArgs {
  readonly nowMs: number;
}

const JOBS = {
  landing: (database: DatabaseSync, { nowMs }: HeavyReadArgs) => ({
    landing: computeLandingStats(database, new Date(nowMs)),
    sources: computeCatalogSources(database),
    salaryStats: computeCatalogSalaryStats(database),
    chips: computeCatalogChips(database, nowMs),
  }),
  salarySnapshots: (database: DatabaseSync, { nowMs }: HeavyReadArgs) =>
    computeSalaryMarketSnapshots(database, new Date(nowMs)),
  sitemaps: (database: DatabaseSync, { nowMs }: HeavyReadArgs) =>
    computeCatalogSitemaps(database, new Date(nowMs)),
};

export type HeavyReadJob = keyof typeof JOBS;
export type HeavyReadResult<K extends HeavyReadJob> = ReturnType<(typeof JOBS)[K]>;

export function computeHeavyRead<K extends HeavyReadJob>(
  database: DatabaseSync,
  job: K,
  args: HeavyReadArgs,
): HeavyReadResult<K> {
  return JOBS[job](database, args) as HeavyReadResult<K>;
}

/** Своё соединение только для чтения: снимок живёт лишь пока идёт расчёт. */
export function runHeavyReadJob<K extends HeavyReadJob>(
  path: string,
  job: K,
  args: HeavyReadArgs,
): HeavyReadResult<K> {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    database.exec('PRAGMA busy_timeout = 10000;');
    return computeHeavyRead(database, job, args);
  } finally {
    database.close();
  }
}
