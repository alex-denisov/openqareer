/**
 * Google's counterpart of IndexNow (04.11): Google does not take IndexNow, and
 * its Indexing API accepts only pages with JobPosting, so this tells it about
 * vacancy cards and nothing else.
 *
 * The published quota is 200 notifications a day and the sitemap holds tens of
 * thousands of cards, so most cards are never notified here and Google finds
 * them through the sitemap. The newest go first, spread over the day so that a
 * card posted in the evening does not wait for the next reset.
 *
 * The key is `OPENQAREER_GSC_SERVICE_ACCOUNT_B64`, not the Vertex one: that is
 * another account in another project, and only this one owns the Search Console
 * property.
 */
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { SITE_ORIGIN } from '../../shared/aeoSurface';
import { parseVacancyPath } from '../../shared/vacancyCatalogRoutes';
import { VertexTokenProvider } from '../providers/vertexAi';
import type { SitemapUrl } from './sitemapXml';

export const GOOGLE_INDEXING_ENDPOINT =
  'https://indexing.googleapis.com/v3/urlNotifications:publish';
const GOOGLE_INDEXING_SCOPE = 'https://www.googleapis.com/auth/indexing';
/** 20 of the project's 200 stay free for the `notify_urls` tool of the gsc connector. */
export const GOOGLE_INDEXING_DAILY_BUDGET = 180;
/** Google's daily quota turns over at midnight Pacific. */
const QUOTA_TIME_ZONE = 'America/Los_Angeles';
const MINUTES_IN_DAY = 1440;
/** One sitemap cycle (`catalogSitemapSchedule`): each may spend up to the end of its slot. */
const CYCLE_MINUTES = 30;
/**
 * A card out of the sitemap for less than this is not treated as withdrawn: a
 * partial source read or a summary version bump drops thousands of live cards
 * for hours, and telling Google to remove them is worse than saying nothing.
 */
const REMOVAL_GRACE_MS = 24 * 3_600_000;
const REQUEST_TIMEOUT_MS = 60_000;

const STATE_TABLES_SQL = `CREATE TABLE IF NOT EXISTS catalog_google_indexing_sent (
  url TEXT PRIMARY KEY,
  lastmod TEXT NOT NULL,
  missing_since_ms INTEGER
) STRICT;
CREATE TABLE IF NOT EXISTS catalog_google_indexing_budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  day TEXT NOT NULL,
  sent INTEGER NOT NULL,
  exhausted INTEGER NOT NULL
) STRICT`;

const serviceAccountSchema = z.object({
  client_email: z.string().min(1),
  private_key: z.string().min(1),
});

interface GoogleIndexingLog {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

type GoogleIndexingNotifier = (
  database: DatabaseSync,
  urls: readonly SitemapUrl[],
) => Promise<void>;

type NotificationType = 'URL_UPDATED' | 'URL_DELETED';

interface Notification {
  readonly url: string;
  readonly type: NotificationType;
  readonly lastmod: string;
}

interface SentRow {
  readonly url: string;
  readonly lastmod: string;
  readonly missing_since_ms: number | null;
}

interface Budget {
  readonly day: string;
  readonly sent: number;
  readonly exhausted: boolean;
}

interface SendContext {
  readonly fetcher: typeof fetch;
  readonly log: GoogleIndexingLog;
  readonly token: string;
}

/**
 * - `done`: Google took it, or rejected this one address; either way, not again.
 * - `quota`: the day is over (380 a minute is out of reach at this budget, so a
 *   429 here is the daily quota).
 * - `stop`: Google or the network is failing for every card; the next cycle retries.
 */
type SendOutcome = 'done' | 'quota' | 'stop';

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

export function parseServiceAccount(encoded: string) {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    const parsed = serviceAccountSchema.safeParse(decoded);
    return parsed.success
      ? { clientEmail: parsed.data.client_email, privateKey: parsed.data.private_key }
      : undefined;
  } catch {
    return undefined;
  }
}

/** The quota day and how far into it we are. */
function pacificClock(now: Date): { day: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: QUOTA_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return {
    day: `${part('year')}-${part('month')}-${part('day')}`,
    minutes: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

function pacedAllowance(minutes: number, sent: number): number {
  const open = Math.min(1, (minutes + CYCLE_MINUTES) / MINUTES_IN_DAY);
  return Math.max(0, Math.ceil(GOOGLE_INDEXING_DAILY_BUDGET * open) - sent);
}

function cardKey(url: string): string | null {
  return parseVacancyPath(new URL(url).pathname);
}

function inTransaction(database: DatabaseSync, write: () => void): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    write();
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function readBudget(database: DatabaseSync, day: string): Budget {
  const row = database
    .prepare('SELECT day, sent, exhausted FROM catalog_google_indexing_budget WHERE id = 1')
    .get() as { day: string; sent: number; exhausted: number } | undefined;
  return row?.day === day
    ? { day, sent: row.sent, exhausted: row.exhausted === 1 }
    : { day, sent: 0, exhausted: false };
}

function writeBudget(database: DatabaseSync, budget: Budget): void {
  database
    .prepare(
      `INSERT INTO catalog_google_indexing_budget (id, day, sent, exhausted) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         day = excluded.day, sent = excluded.sent, exhausted = excluded.exhausted`,
    )
    .run(budget.day, budget.sent, budget.exhausted ? 1 : 0);
}

/**
 * A card's address carries its title, but the page is found by the key at its
 * end: after a retitle the old address still answers 200 with the live card, so
 * it is not a removal. The new address is a new notification.
 */
function forgetRetitled(database: DatabaseSync, current: ReadonlyMap<string, string>): void {
  const liveKeys = new Set([...current.keys()].map(cardKey));
  const rows = database.prepare('SELECT url FROM catalog_google_indexing_sent').all() as Array<{
    url: string;
  }>;
  const retitled = rows.filter((row) => !current.has(row.url) && liveKeys.has(cardKey(row.url)));
  if (retitled.length === 0) return;
  const remove = database.prepare('DELETE FROM catalog_google_indexing_sent WHERE url = ?');
  inTransaction(database, () => {
    for (const row of retitled) remove.run(row.url);
  });
}

/** Keeps `missing_since_ms` in step with the sitemap and returns the rows as they now are. */
function syncMissing(
  database: DatabaseSync,
  current: ReadonlyMap<string, string>,
  nowMs: number,
): SentRow[] {
  const rows = database
    .prepare('SELECT url, lastmod, missing_since_ms FROM catalog_google_indexing_sent')
    .all() as unknown as SentRow[];
  const synced = rows.map((row) => {
    if (current.has(row.url)) return { ...row, missing_since_ms: null };
    return { ...row, missing_since_ms: row.missing_since_ms ?? nowMs };
  });
  const moved = synced.filter(
    (row, index) => row.missing_since_ms !== rows[index]?.missing_since_ms,
  );
  if (moved.length > 0) {
    const update = database.prepare(
      'UPDATE catalog_google_indexing_sent SET missing_since_ms = ? WHERE url = ?',
    );
    inTransaction(database, () => {
      for (const row of moved) update.run(row.missing_since_ms, row.url);
    });
  }
  return synced;
}

function buildQueues(
  current: ReadonlyMap<string, string>,
  rows: readonly SentRow[],
  nowMs: number,
): { updates: Notification[]; removals: Notification[] } {
  const sent = new Map(rows.map((row) => [row.url, row.lastmod]));
  const updates = [...current]
    .filter(([url, lastmod]) => {
      const known = sent.get(url);
      return known === undefined || lastmod > known;
    })
    .map(([url, lastmod]): Notification => ({ url, type: 'URL_UPDATED', lastmod }));
  const removals = rows
    .filter(
      (row) => row.missing_since_ms !== null && nowMs - row.missing_since_ms >= REMOVAL_GRACE_MS,
    )
    .map((row): Notification => ({ url: row.url, type: 'URL_DELETED', lastmod: row.lastmod }));
  return { updates, removals };
}

/**
 * New cards first. Removals keep up to half of the allowance: the backlog of
 * new cards never runs out, and only cards we announced ever come up for
 * removal, so in the long run the two rates are equal. Whatever one queue does
 * not use goes to the other.
 */
function pickBatch(
  updates: readonly Notification[],
  removals: readonly Notification[],
  allowance: number,
): Notification[] {
  const updateCount = Math.min(
    updates.length,
    allowance - Math.min(removals.length, Math.floor(allowance / 2)),
  );
  const removalCount = Math.min(removals.length, allowance - updateCount);
  return [...updates.slice(0, updateCount), ...removals.slice(0, removalCount)];
}

function recordDone(database: DatabaseSync, item: Notification): void {
  if (item.type === 'URL_DELETED') {
    database.prepare('DELETE FROM catalog_google_indexing_sent WHERE url = ?').run(item.url);
    return;
  }
  database
    .prepare(
      `INSERT INTO catalog_google_indexing_sent (url, lastmod, missing_since_ms) VALUES (?, ?, NULL)
       ON CONFLICT(url) DO UPDATE SET lastmod = excluded.lastmod, missing_since_ms = NULL`,
    )
    .run(item.url, item.lastmod);
}

async function publish(item: Notification, context: SendContext): Promise<SendOutcome> {
  const details = { url: item.url, type: item.type };
  try {
    const response = await context.fetcher(GOOGLE_INDEXING_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${context.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: item.url, type: item.type }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await response.body?.cancel();
    if (response.ok) return 'done';
    if (response.status === 429) return 'quota';
    const failing = response.status !== 400 && response.status !== 404;
    context.log.error(
      { ...details, statusCode: response.status },
      failing ? 'google-indexing-send-failed' : 'google-indexing-rejected',
    );
    return failing ? 'stop' : 'done';
  } catch (error: unknown) {
    context.log.error({ ...details, errorName: errorName(error) }, 'google-indexing-send-failed');
    return 'stop';
  }
}

interface BatchResult {
  readonly budget: Budget;
  readonly updated: number;
  readonly deleted: number;
  readonly sample: readonly string[];
}

/** One request at a time; state and budget are saved after each, so a crash repeats nothing. */
async function sendBatch(
  database: DatabaseSync,
  batch: readonly Notification[],
  startBudget: Budget,
  context: SendContext,
): Promise<BatchResult> {
  let budget = startBudget;
  let updated = 0;
  let deleted = 0;
  const sample: string[] = [];
  for (const item of batch) {
    const outcome = await publish(item, context);
    if (outcome === 'stop') break;
    budget = { ...budget, sent: budget.sent + 1, exhausted: outcome === 'quota' };
    const spent = budget;
    inTransaction(database, () => {
      writeBudget(database, spent);
      if (outcome === 'done') recordDone(database, item);
    });
    if (outcome === 'quota') break;
    if (item.type === 'URL_UPDATED') updated += 1;
    else deleted += 1;
    if (sample.length < 3) sample.push(item.url);
  }
  return { budget, updated, deleted, sample };
}

function currentCards(urls: readonly SitemapUrl[]): Map<string, string> {
  const cards = urls.filter((item) => parseVacancyPath(item.path) !== null);
  return new Map(
    cards.map((item) => [new URL(item.path, SITE_ORIGIN).toString(), item.lastmod ?? '']),
  );
}

async function runCycle(
  database: DatabaseSync,
  urls: readonly SitemapUrl[],
  tokens: VertexTokenProvider,
  log: GoogleIndexingLog,
  fetcher: typeof fetch,
  now: Date,
): Promise<void> {
  const current = currentCards(urls);
  // A sitemap without a single card is a failed read: nothing here says the cards are gone.
  if (current.size === 0) return;
  database.exec(STATE_TABLES_SQL);
  forgetRetitled(database, current);
  const rows = syncMissing(database, current, now.getTime());
  const { day, minutes } = pacificClock(now);
  const startBudget = readBudget(database, day);
  const { updates, removals } = buildQueues(current, rows, now.getTime());
  const allowance = startBudget.exhausted ? 0 : pacedAllowance(minutes, startBudget.sent);
  const batch = pickBatch(updates, removals, allowance);
  const result =
    batch.length > 0
      ? await sendBatch(database, batch, startBudget, {
          fetcher,
          log,
          token: await tokens.token(),
        })
      : { budget: startBudget, updated: 0, deleted: 0, sample: [] };
  log.info(
    {
      updated: result.updated,
      deleted: result.deleted,
      queuedUpdates: updates.length - result.updated,
      queuedRemovals: removals.length - result.deleted,
      sentToday: result.budget.sent,
      budget: GOOGLE_INDEXING_DAILY_BUDGET,
      quotaExhausted: result.budget.exhausted,
      sample: result.sample,
    },
    'google-indexing-cycle',
  );
}

/** Creates one maintenance-cycle notifier; a missing or broken key is logged once. */
export function createGoogleIndexingNotifier(
  rawKey: string | undefined,
  log: GoogleIndexingLog,
  fetcher: typeof fetch = fetch,
  clock: () => Date = () => new Date(),
): GoogleIndexingNotifier {
  const encoded = rawKey?.trim() ?? '';
  if (!encoded) {
    log.info({}, 'google-indexing-disabled-no-key');
    return async () => undefined;
  }
  const account = parseServiceAccount(encoded);
  if (!account) {
    log.error({}, 'google-indexing-disabled-bad-key');
    return async () => undefined;
  }
  const tokens = new VertexTokenProvider(
    account,
    fetcher,
    () => clock().getTime(),
    GOOGLE_INDEXING_SCOPE,
  );
  return async (database, urls) => {
    try {
      await runCycle(database, urls, tokens, log, fetcher, clock());
    } catch (error: unknown) {
      log.error({ errorName: errorName(error) }, 'google-indexing-failed');
    }
  };
}
