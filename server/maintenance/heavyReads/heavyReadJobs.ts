/**
 * B649-3: тяжёлые чтения обслуживания, которые держали цикл событий
 * (прод 12–13.11: лендинг 117–160 с, зарплатные снимки 789 с, карты сайта ~40 с).
 * Каждое — чистое чтение; запись остаётся у соединения-писателя.
 */
import { DatabaseSync } from 'node:sqlite';
import { computeLandingStats } from '../../landing/landingStatsJob';
import { catalogSourcesOf, readPoolCounts } from '../../vacancies/catalogSources';
import { computeCatalogSalaryStats } from '../../vacancies/catalogSalaryStatsStore';
import { computeCatalogChips } from '../../vacancies/catalogChipStore';
import { computeSalaryMarketSnapshots } from '../../salaryMarket/salaryMarketSnapshot';
import { computeCatalogSitemaps } from '../../seo/catalogSitemapJob';
import { chooseCardRolloutCandidates } from '../../seo/catalogCardRollout';
import { computeAndWriteLanding } from '../../landing/landingResultWrite';
import { applySqliteBusyTimeout } from '../../data/sqliteBusyTimeout';

export interface HeavyReadArgs {
  readonly nowMs: number;
  /** B761: сколько карточек выбрать в порцию открытия (`cardRolloutCandidates`). */
  readonly quota?: number;
}

const JOBS = {
  landing: (database: DatabaseSync, { nowMs }: HeavyReadArgs) => {
    const pool = readPoolCounts(database);
    return {
      landing: computeLandingStats(database, new Date(nowMs), { pool }),
      sources: catalogSourcesOf(pool),
      salaryStats: computeCatalogSalaryStats(database),
      chips: computeCatalogChips(database, nowMs),
    };
  },
  salarySnapshots: (database: DatabaseSync, { nowMs }: HeavyReadArgs) =>
    computeSalaryMarketSnapshots(database, new Date(nowMs)),
  sitemaps: (database: DatabaseSync, { nowMs }: HeavyReadArgs) =>
    computeCatalogSitemaps(database, new Date(nowMs)),
  cardRolloutCandidates: (database: DatabaseSync, { nowMs, quota }: HeavyReadArgs) =>
    chooseCardRolloutCandidates(database, new Date(nowMs), quota ?? 0),
  // B649-5: в процессе (тесты, dev) читатель и писатель — одно соединение.
  landingWrite: (database: DatabaseSync, { nowMs }: HeavyReadArgs) =>
    computeAndWriteLanding(database, () => database, nowMs),
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
  if (job === 'landingWrite') return runLandingWriteJob(path, args) as HeavyReadResult<K>;
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    database.exec('PRAGMA busy_timeout = 10000;');
    return computeHeavyRead(database, job, args);
  } finally {
    database.close();
  }
}

/**
 * B649-5: поток считает на readOnly-соединении, закрывает снимок и пишет
 * итоги порциями своим соединением-писателем; наружу — только сводка.
 */
function runLandingWriteJob(
  path: string,
  { nowMs }: HeavyReadArgs,
): HeavyReadResult<'landingWrite'> {
  const reader = new DatabaseSync(path, { readOnly: true });
  let readerOpen = true;
  let writer: DatabaseSync | undefined;
  const closeReader = () => {
    if (readerOpen) reader.close();
    readerOpen = false;
  };
  try {
    reader.exec('PRAGMA busy_timeout = 10000;');
    return computeAndWriteLanding(
      reader,
      () => {
        writer = new DatabaseSync(path);
        applySqliteBusyTimeout(writer);
        return writer;
      },
      nowMs,
      closeReader,
    );
  } finally {
    closeReader();
    writer?.close();
  }
}
