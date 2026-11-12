/**
 * B535: timers for the landing's pool numbers.
 * - Maintenance process: compute and write `landing_stats` every 30 minutes.
 * - Web server: read that one row every 5 minutes into the in-memory cache.
 */
import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import { schedulePersistedJob } from '../maintenance/persistedJobSchedule';
import { setLandingStats } from './landingStatsCache';
import { heavyRead } from '../maintenance/heavyReads/runHeavyRead';
import {
  readCatalogSources,
  setCatalogSources,
  writeCatalogSources,
} from '../vacancies/catalogSources';
import { writeCatalogSalaryStats } from '../vacancies/catalogSalaryStatsStore';
import { writeCatalogChips } from '../vacancies/catalogChipStore';
import { readLandingStats, writeLandingStats } from './landingStatsJob';

interface StatsLog {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

const JOB_FIRST_RUN_MS = 60_000;
const JOB_INTERVAL_MS = 30 * 60_000;
const REFRESH_INTERVAL_MS = 5 * 60_000;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

/** Maintenance process only: the counts scan the whole pool index. */
export function scheduleLandingStatsJob(database: DatabaseSync, log: StatsLog): () => void {
  // B649-3: the counts read in their own thread (117–160 s on the loop, 12.11).
  const run = async (): Promise<boolean> => {
    const started = Date.now();
    try {
      const now = new Date();
      const read = await heavyRead(database, 'landing', { nowMs: now.getTime() }, log);
      const stats = read.landing;
      writeLandingStats(database, stats, now);
      writeCatalogSources(database, read.sources, now);
      writeCatalogSalaryStats(database, read.salaryStats, now);
      const chips = writeCatalogChips(database, read.chips, now);
      log.info({ ...chips }, 'catalog-chips-written');
      log.info(
        { ms: Date.now() - started, active: stats.activeCount, rows: stats.vacancies.length },
        'landing-stats-written',
      );
      return true;
    } catch (error: unknown) {
      log.error({ errorName: errorName(error), ms: Date.now() - started }, 'landing-stats-failed');
      return false;
    }
  };
  return schedulePersistedJob(database, log, {
    job: 'landing-stats',
    firstRunMs: JOB_FIRST_RUN_MS,
    intervalMs: JOB_INTERVAL_MS,
    run,
  });
}

/** Web server: a primary-key read of one row, then the cache is replaced. */
export function scheduleLandingStatsRefresh(databasePath: string, log: StatsLog): () => void {
  const refresh = () => {
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(databasePath, { readOnly: true });
      applySqliteBusyTimeout(database);
      const stats = readLandingStats(database);
      if (stats) setLandingStats(stats);
      setCatalogSources(readCatalogSources(database));
    } catch (error: unknown) {
      log.error({ errorName: errorName(error) }, 'landing-stats-refresh-failed');
    } finally {
      database?.close();
    }
  };
  refresh();
  const every = setInterval(refresh, REFRESH_INTERVAL_MS);
  every.unref();
  return () => clearInterval(every);
}
