import type { DatabaseSync } from 'node:sqlite';
import { SITE_ORIGIN } from '../../shared/aeoSurface';
import type { SitemapUrl } from './sitemapXml';

// The global participating endpoint shares receipts across IndexNow search engines.
// The Yandex-specific endpoint timed out from production; the global endpoint accepted a live probe.
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const INDEXNOW_URL_LIMIT = 10_000;
const INDEXNOW_REQUEST_TIMEOUT_MS = 15_000;

const INDEXNOW_TABLE_SQL = `CREATE TABLE IF NOT EXISTS catalog_indexnow_sent (
  url TEXT PRIMARY KEY,
  lastmod TEXT
) STRICT`;

interface IndexNowLog {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

interface IndexNowFingerprint {
  readonly url: string;
  readonly lastmod?: string;
}

type IndexNowFetcher = typeof fetch;
type IndexNowNotifier = (
  database: DatabaseSync,
  urls: readonly SitemapUrl[],
) => Promise<void>;

export function isValidIndexNowKey(value: string): boolean {
  return /^[A-Za-z0-9-]{8,128}$/u.test(value);
}

function absoluteUrl(path: string): string {
  return new URL(path, SITE_ORIGIN).toString();
}

function currentFingerprints(urls: readonly SitemapUrl[]): Map<string, string | null> {
  const result = new Map<string, string | null>();
  for (const item of urls) result.set(absoluteUrl(item.path), item.lastmod ?? null);
  return result;
}

function readSent(database: DatabaseSync): Map<string, string | null> {
  database.exec(INDEXNOW_TABLE_SQL);
  const rows = database
    .prepare('SELECT url, lastmod FROM catalog_indexnow_sent')
    .all() as Array<{ url: string; lastmod: string | null }>;
  return new Map(rows.map((row) => [row.url, row.lastmod]));
}

function writeSent(database: DatabaseSync, batch: readonly IndexNowFingerprint[]): void {
  const upsert = database.prepare(
    `INSERT INTO catalog_indexnow_sent (url, lastmod) VALUES (?, ?)
     ON CONFLICT(url) DO UPDATE SET lastmod = excluded.lastmod`,
  );
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const item of batch) upsert.run(item.url, item.lastmod ?? null);
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function forgetRemoved(database: DatabaseSync, current: ReadonlyMap<string, string | null>): void {
  const rows = database
    .prepare('SELECT url FROM catalog_indexnow_sent')
    .all() as Array<{ url: string }>;
  const removed = rows.map((row) => row.url).filter((url) => !current.has(url));
  if (removed.length === 0) return;
  const remove = database.prepare('DELETE FROM catalog_indexnow_sent WHERE url = ?');
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const url of removed) remove.run(url);
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    result.push(values.slice(start, start + size));
  }
  return result;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

async function submitBatch(
  key: string,
  batch: readonly IndexNowFingerprint[],
  log: IndexNowLog,
  fetcher: IndexNowFetcher,
): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INDEXNOW_REQUEST_TIMEOUT_MS);
  try {
    return await fetcher(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: new URL(SITE_ORIGIN).host,
        key,
        urlList: batch.map((item) => item.url),
      }),
      signal: controller.signal,
    });
  } catch (error: unknown) {
    log.error({ errorName: errorName(error) }, 'indexnow-submit-failed');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendChanged(
  database: DatabaseSync,
  urls: readonly SitemapUrl[],
  key: string,
  log: IndexNowLog,
  fetcher: IndexNowFetcher,
): Promise<void> {
  const current = currentFingerprints(urls);
  const sent = readSent(database);
  const changed = [...current].filter(([url, lastmod]) => sent.get(url) !== lastmod);
  for (const group of chunks(changed, INDEXNOW_URL_LIMIT)) {
    const batch = group.map(([url, lastmod]) => ({ url, lastmod: lastmod ?? undefined }));
    const response = await submitBatch(key, batch, log, fetcher);
    if (!response) return;
    if (!response.ok) {
      log.error({ statusCode: response.status }, 'indexnow-submit-failed');
      return;
    }
    try {
      writeSent(database, batch);
    } catch (error: unknown) {
      log.error({ errorName: errorName(error) }, 'indexnow-state-write-failed');
      return;
    }
  }
  try {
    forgetRemoved(database, current);
  } catch (error: unknown) {
    log.error({ errorName: errorName(error) }, 'indexnow-state-cleanup-failed');
  }
}

/** Creates one maintenance-cycle notifier; a missing or invalid key is logged once. */
export function createIndexNowNotifier(
  rawKey: string | undefined,
  log: IndexNowLog,
  fetcher: IndexNowFetcher = fetch,
): IndexNowNotifier {
  const key = rawKey?.trim() ?? '';
  if (!key) {
    log.info({}, 'indexnow-disabled-no-key');
    return async () => undefined;
  }
  if (!isValidIndexNowKey(key)) {
    log.error({}, 'indexnow-disabled-invalid-key');
    return async () => undefined;
  }
  return async (database, urls) => {
    try {
      await sendChanged(database, urls, key, log, fetcher);
    } catch (error: unknown) {
      log.error({ errorName: errorName(error) }, 'indexnow-state-failed');
    }
  };
}
