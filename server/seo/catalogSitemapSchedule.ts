/**
 * Timers for the sitemap files, mirroring the landing numbers (B535):
 * - Maintenance process: compute and write `catalog_sitemaps` every 30 minutes.
 * - Web server: read those rows and `catalog_listing_history` every 5 minutes
 *   into memory; the HTTP path only ever reads memory.
 */
import { googleIndexingKey } from './googleIndexingSwitch';
import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import type { OwnerTelegramConfig } from '../notifications/ownerTelegram';
import { admitCardRollout, cardRolloutDailyCap } from './catalogCardRollout';
import { checkIndexCoverage } from './catalogIndexCoverage';
import { snapshotDue, snapshotSitemapCards } from './catalogArchive';
import { heavyRead } from '../maintenance/heavyReads/runHeavyRead';
import {
  readCatalogSitemaps,
  writeCatalogSitemaps,
} from './catalogSitemapJob';
import type { ListingIndexHistory } from './catalogIndexing';
import { listingHistoryKey, readListingHistory } from './catalogListingHistory';
import { createGoogleIndexingNotifier } from './googleIndexing';
import { createIndexNowNotifier } from './indexNow';
import type { SitemapFile } from './sitemapXml';
import { ensureMarketReport, previousMonth, readMarketReports } from './marketReport';
import { setMarketReports } from './marketReportSnapshot';

interface SitemapLog {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

const JOB_FIRST_RUN_MS = 90_000;
const JOB_INTERVAL_MS = 30 * 60_000;
const REFRESH_INTERVAL_MS = 5 * 60_000;

let current: readonly SitemapFile[] | null = null;
let listingHistory: ReadonlyMap<string, ListingIndexHistory> = new Map();

/** Files written by the maintenance process, or null before the first read. */
export function getCatalogSitemaps(): readonly SitemapFile[] | null {
  return current;
}

export function setCatalogSitemaps(next: readonly SitemapFile[] | null): void {
  if (next && next.length > 0) current = next;
}

/** Undefined: the listing was never published, so its path never existed for crawlers. */
export function getListingHistory(place: string, role?: string): ListingIndexHistory | undefined {
  return listingHistory.get(listingHistoryKey(place, role));
}

export function setListingHistory(next: ReadonlyMap<string, ListingIndexHistory>): void {
  listingHistory = next;
}

/** Test seam. */
export function resetCatalogSitemaps(): void {
  current = null;
  listingHistory = new Map();
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

/** A failed step leaves the set as it is and never stops the sitemap files. */
function runCardRollout(database: DatabaseSync, log: SitemapLog, now: Date): void {
  try {
    const cap = cardRolloutDailyCap(process.env.OPENQAREER_CARD_ROLLOUT_DAILY_CAP);
    const started = Date.now();
    const report = admitCardRollout(database, now, cap);
    log.info({ ...report, cap, ms: Date.now() - started }, 'catalog-card-rollout');
  } catch (error: unknown) {
    log.error({ errorName: errorName(error) }, 'catalog-card-rollout-failed');
  }
}

/** GEO 09.11: the last finished month, once; a failure never stops the sitemap files. */
function runMarketReport(database: DatabaseSync, log: SitemapLog, now: Date): void {
  try {
    const started = Date.now();
    if (ensureMarketReport(database, now))
      log.info({ month: previousMonth(now), ms: Date.now() - started }, 'market-report-written');
  } catch (error: unknown) {
    log.error({ errorName: errorName(error) }, 'market-report-failed');
  }
}

/** 11.11: today's sitemap cards are copied for their archive pages; never stops the files. */
function runArchiveSnapshot(
  database: DatabaseSync,
  urls: ReadonlyArray<{ readonly path: string }>,
  log: SitemapLog,
  now: Date,
): void {
  try {
    if (!snapshotDue(database, now)) return;
    const started = Date.now();
    const copied = snapshotSitemapCards(
      database,
      urls.map((url) => url.path),
      now,
    );
    log.info({ copied, ms: Date.now() - started }, 'catalog-archive-snapshot');
  } catch (error: unknown) {
    log.error({ errorName: errorName(error) }, 'catalog-archive-snapshot-failed');
  }
}

/** Maintenance process only: the listings query groups the whole catalog. */
export function scheduleCatalogSitemapJob(
  database: DatabaseSync,
  log: SitemapLog,
  telegram: OwnerTelegramConfig = {},
): () => void {
  const notifyIndexNow = createIndexNowNotifier(process.env.INDEXNOW_KEY, log);
  const notifyGoogle = createGoogleIndexingNotifier(googleIndexingKey(process.env), log);
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    const started = Date.now();
    try {
      const now = new Date();
      runCardRollout(database, log, now);
      runMarketReport(database, log, now);
      // B649-3: grouping the catalog held the loop ~40 s; read in its own thread.
      const files = await heavyRead(database, 'sitemaps', { nowMs: now.getTime() }, log);
      writeCatalogSitemaps(database, files, now);
      await checkIndexCoverage({ database, files, telegram, log, now });
      const urls = files.flatMap((file) => file.urls ?? []);
      runArchiveSnapshot(database, urls, log, now);
      await notifyIndexNow(database, urls);
      await notifyGoogle(database, urls);
      log.info(
        {
          ms: Date.now() - started,
          files: files.map((file) => `${file.name}:${file.urlCount}`).join(','),
        },
        'catalog-sitemaps-written',
      );
    } catch (error: unknown) {
      log.error(
        { errorName: errorName(error), ms: Date.now() - started },
        'catalog-sitemaps-failed',
      );
    } finally {
      running = false;
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

/** Web server: a read of a handful of rows, then the in-memory set is replaced. */
export function scheduleCatalogSitemapRefresh(databasePath: string, log: SitemapLog): () => void {
  const refresh = () => {
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(databasePath, { readOnly: true });
      applySqliteBusyTimeout(database);
      setCatalogSitemaps(readCatalogSitemaps(database));
      setListingHistory(readListingHistory(database));
      setMarketReports(readMarketReports(database));
    } catch (error: unknown) {
      log.error({ errorName: errorName(error) }, 'catalog-sitemaps-refresh-failed');
    } finally {
      database?.close();
    }
  };
  refresh();
  const every = setInterval(refresh, REFRESH_INTERVAL_MS);
  every.unref();
  return () => clearInterval(every);
}
