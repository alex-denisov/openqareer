/**
 * Timers for the sitemap files, mirroring the landing numbers (B535):
 * - Maintenance process: compute and write `catalog_sitemaps` every 30 minutes.
 * - Web server: read those rows every 5 minutes into memory; the HTTP path
 *   only ever reads memory.
 */
import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import {
  computeCatalogSitemaps,
  readCatalogSitemaps,
  writeCatalogSitemaps,
} from './catalogSitemapJob';
import type { SitemapFile } from './sitemapXml';

interface SitemapLog {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

const JOB_FIRST_RUN_MS = 90_000;
const JOB_INTERVAL_MS = 30 * 60_000;
const REFRESH_INTERVAL_MS = 5 * 60_000;

let current: readonly SitemapFile[] | null = null;

/** Files written by the maintenance process, or null before the first read. */
export function getCatalogSitemaps(): readonly SitemapFile[] | null {
  return current;
}

export function setCatalogSitemaps(next: readonly SitemapFile[] | null): void {
  if (next && next.length > 0) current = next;
}

/** Test seam. */
export function resetCatalogSitemaps(): void {
  current = null;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

/** Maintenance process only: the listings query groups the whole catalog. */
export function scheduleCatalogSitemapJob(database: DatabaseSync, log: SitemapLog): () => void {
  const run = () => {
    const started = Date.now();
    try {
      const now = new Date();
      const files = computeCatalogSitemaps(database, now);
      writeCatalogSitemaps(database, files, now);
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
