import type { DatabaseSync } from 'node:sqlite';
import { SITE_ORIGIN } from '../../shared/aeoSurface';
import { nextTurn } from '../data/chunkedRows';
import { inWriteTransaction } from '../data/writePortions';
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

/** 24.11: ~290 тысяч адресов — порциями, с тактом цикла событий между ними. */
const STATE_PORTION = 1_000;

async function currentFingerprints(
  urls: readonly SitemapUrl[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  for (const group of chunks(urls, STATE_PORTION)) {
    for (const item of group) result.set(absoluteUrl(item.path), item.lastmod ?? null);
    await nextTurn();
  }
  return result;
}

/** Paged by key: an open cursor would stay on the writer connection between turns. */
async function readSent(database: DatabaseSync): Promise<Map<string, string | null>> {
  database.exec(INDEXNOW_TABLE_SQL);
  const page = database.prepare(
    'SELECT url, lastmod FROM catalog_indexnow_sent WHERE url > ? ORDER BY url LIMIT ?',
  );
  const sent = new Map<string, string | null>();
  for (let after = ''; ;) {
    const rows = page.all(after, STATE_PORTION) as Array<{ url: string; lastmod: string | null }>;
    for (const row of rows) sent.set(row.url, row.lastmod);
    const last = rows.at(-1);
    if (!last || rows.length < STATE_PORTION) return sent;
    after = last.url;
    await nextTurn();
  }
}

async function inPortions<T>(
  database: DatabaseSync,
  rows: readonly T[],
  write: (row: T) => void,
): Promise<void> {
  for (const group of chunks(rows, STATE_PORTION)) {
    inWriteTransaction(database, () => group.forEach(write));
    await nextTurn();
  }
}

async function writeSent(
  database: DatabaseSync,
  batch: readonly IndexNowFingerprint[],
): Promise<void> {
  const upsert = database.prepare(
    `INSERT INTO catalog_indexnow_sent (url, lastmod) VALUES (?, ?)
     ON CONFLICT(url) DO UPDATE SET lastmod = excluded.lastmod`,
  );
  await inPortions(database, batch, (item) => {
    upsert.run(item.url, item.lastmod ?? null);
  });
}

async function forgetRemoved(
  database: DatabaseSync,
  sent: ReadonlyMap<string, string | null>,
  current: ReadonlyMap<string, string | null>,
): Promise<void> {
  const removed = [...sent.keys()].filter((url) => !current.has(url));
  const remove = database.prepare('DELETE FROM catalog_indexnow_sent WHERE url = ?');
  await inPortions(database, removed, (url) => {
    remove.run(url);
  });
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
  const current = await currentFingerprints(urls);
  const sent = await readSent(database);
  const changed = [...current].filter(([url, lastmod]) => sent.get(url) !== lastmod);
  for (const group of chunks(changed, INDEXNOW_URL_LIMIT)) {
    const batch = group.map(([url, lastmod]) => ({ url, lastmod: lastmod ?? undefined }));
    if (!(await submitEverywhere(key, batch, log, fetcher))) return;
    try {
      await writeSent(database, batch);
    } catch (error: unknown) {
      log.error({ errorName: errorName(error) }, 'indexnow-state-write-failed');
      return;
    }
  }
  try {
    await forgetRemoved(database, sent, current);
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
