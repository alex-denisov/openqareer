/**
 * B535: timers for the landing's pool numbers.
 * - Maintenance process: compute and write `landing_stats` every 30 minutes.
 * - Web server: read that one row every 5 minutes into the in-memory cache.
 */
import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import { setLandingStats } from './landingStatsCache';
import {
  computeCatalogSources,
  readCatalogSources,
  setCatalogSources,
  writeCatalogSources,
} from '../vacancies/catalogSources';
import {
  computeCatalogSalaryStats,
  writeCatalogSalaryStats,
} from '../vacancies/catalogSalaryStatsStore';
import { computeCatalogChips, writeCatalogChips } from '../vacancies/catalogChipStore';
import { computeLandingStats, readLandingStats, writeLandingStats } from './landingStatsJob';

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
  const run = () => {
    const started = Date.now();
    try {
      const now = new Date();
      const stats = computeLandingStats(database, now);
      writeLandingStats(database, stats, now);
      writeCatalogSources(database, computeCatalogSources(database), now);
      writeCatalogSalaryStats(database, computeCatalogSalaryStats(database), now);
      writeCatalogChips(database, computeCatalogChips(database, now.getTime()), now);
      log.info(
        { ms: Date.now() - started, active: stats.activeCount, rows: stats.vacancies.length },
        'landing-stats-written',
      );
    } catch (error: unknown) {
      log.error({ errorName: errorName(error), ms: Date.now() - started }, 'landing-stats-failed');
    }
  };
  const first = setTimeout(run, JOB_FIRST_RUN_MS);
  const every = setInterval(run, JOB_INTERVAL_MS);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
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
