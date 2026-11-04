import type { DatabaseSync } from 'node:sqlite';
import { SITE_ORIGIN } from '../../shared/aeoSurface';
import type { SitemapUrl } from './sitemapXml';

// The shared endpoint relays to the participating engines; Yandex search is the
// target and the relay to it is not guaranteed, so Yandex gets the batch directly
// too (both answered 200 from prod with Node fetch, 03.11).
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const YANDEX_INDEXNOW_ENDPOINT = 'https://yandex.com/indexnow';
export const INDEXNOW_ENDPOINTS = [INDEXNOW_ENDPOINT, YANDEX_INDEXNOW_ENDPOINT] as const;
export const INDEXNOW_URL_LIMIT = 10_000;
/**
 * 03.11: 84 of 92 failures were AbortError on the first pass after a restart,
 * when the maintenance process still holds its event loop with start-up work
 * and the 15 s timer fired before the answer was read. Both endpoints answer
 * 10 000 URLs within ~1 s from prod, so the budget covers a busy loop, not a
 * slow peer.
 */
const INDEXNOW_REQUEST_TIMEOUT_MS = 60_000;

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
type IndexNowNotifier = (database: DatabaseSync, urls: readonly SitemapUrl[]) => Promise<void>;

export function isValidIndexNowKey(value: string): boolean {
  return /^[A-Za-z0-9-]{8,128}$/u.test(value);
}

function absoluteUrl(path: string): string {
  return new URL(path, SITE_ORIGIN).toString();
}

function currentFingerprints(urls: readonly SitemapUrl[]): Map<string, string | null> {
  const result = new Map<string, string | null>();
  for (const item of urls) {
    // Restricted by the source's terms: not sent, and `forgetRemoved` drops it silently.
    if (!item.searchRestricted) result.set(absoluteUrl(item.path), item.lastmod ?? null);
  }
  return result;
}

function readSent(database: DatabaseSync): Map<string, string | null> {
  database.exec(INDEXNOW_TABLE_SQL);
  const rows = database.prepare('SELECT url, lastmod FROM catalog_indexnow_sent').all() as Array<{
    url: string;
    lastmod: string | null;
  }>;
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
  const rows = database.prepare('SELECT url FROM catalog_indexnow_sent').all() as Array<{
    url: string;
  }>;
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

/** One POST; true when the endpoint accepted the batch. Logs either way. */
async function submitBatch(
  endpoint: string,
  key: string,
  batch: readonly IndexNowFingerprint[],
  log: IndexNowLog,
  fetcher: IndexNowFetcher,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INDEXNOW_REQUEST_TIMEOUT_MS);
  const started = Date.now();
  const target = new URL(endpoint).host;
  try {
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: new URL(SITE_ORIGIN).host,
        key,
        urlList: batch.map((item) => item.url),
      }),
      signal: controller.signal,
    });
    const details = { endpoint: target, urls: batch.length, statusCode: response.status };
    if (!response.ok) {
      log.error({ ...details, ms: Date.now() - started }, 'indexnow-submit-failed');
      return false;
    }
    log.info({ ...details, ms: Date.now() - started }, 'indexnow-submitted');
    return true;
  } catch (error: unknown) {
    log.error(
      {
        endpoint: target,
        urls: batch.length,
        errorName: errorName(error),
        ms: Date.now() - started,
      },
      'indexnow-submit-failed',
    );
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** Every endpoint gets the batch; it counts as sent once any of them accepted it. */
async function submitEverywhere(
  key: string,
  batch: readonly IndexNowFingerprint[],
  log: IndexNowLog,
  fetcher: IndexNowFetcher,
): Promise<boolean> {
  let accepted = false;
  for (const endpoint of INDEXNOW_ENDPOINTS) {
    if (await submitBatch(endpoint, key, batch, log, fetcher)) accepted = true;
  }
  return accepted;
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
    if (!(await submitEverywhere(key, batch, log, fetcher))) return;
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
