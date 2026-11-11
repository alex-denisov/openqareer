/**
 * Listings that Google already shows (04.11).
 *
 * `/vacancies/dubai/electrical-engineer` had 26 impressions on 23.10 and then
 * lost `index` to the vacancy threshold; 137 of 351 listings with impressions in
 * 15 days were closed on 04.11. `catalog_listing_history` starts on 02.11, so it
 * knows nothing about what qualified before. Search Console does: the maintenance
 * process reads it once a day, and a listing seen there counts as evidence for
 * `isIndexableListing`.
 */
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { SITE_ORIGIN } from '../../shared/aeoSurface';
import { parseListingPath, parseVacancyPath } from '../../shared/vacancyCatalogRoutes';
import { recordArchiveImpressions } from './catalogArchive';
import { VertexTokenProvider } from '../providers/vertexAi';
import { CATALOG_LISTING_SEARCH_EVIDENCE_TABLE_SQL } from './catalogListingHistory';
import { parseServiceAccount } from './googleIndexing';

const SEARCH_READ_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const WINDOW_DAYS = 28;
const ROW_LIMIT = 25_000;
const REQUEST_TIMEOUT_MS = 30_000;
const FIRST_RUN_MS = 5 * 60_000;
const INTERVAL_MS = 24 * 60 * 60_000;
const DAY_MS = 86_400_000;

const responseSchema = z.object({
  rows: z
    .array(z.object({ keys: z.array(z.string()).min(1), impressions: z.number() }))
    .default([]),
});

export interface SearchEvidenceLog {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

interface TokenSource {
  token(): Promise<string>;
}

function isoDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

async function readPages(tokens: TokenSource, fetcher: typeof fetch, now: Date) {
  const site = encodeURIComponent(`${SITE_ORIGIN}/`);
  const response = await fetcher(
    `https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await tokens.token()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate: isoDay(now.getTime() - WINDOW_DAYS * DAY_MS),
        endDate: isoDay(now.getTime()),
        dimensions: ['page'],
        dataState: 'all',
        rowLimit: ROW_LIMIT,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error(`http_${response.status}`);
  return responseSchema.parse(await response.json()).rows;
}

function listingKeys(rows: Awaited<ReturnType<typeof readPages>>) {
  const listings = new Map<string, { place: string; role: string }>();
  for (const row of rows) {
    if (row.impressions <= 0) continue;
    const listing = parseListingPath(new URL(row.keys[0] ?? '', SITE_ORIGIN).pathname);
    if (!listing) continue;
    const role = listing.role ?? '';
    listings.set(`${listing.place}/${role}`, { place: listing.place, role });
  }
  return [...listings.values()];
}

/** 11.11: card pages Google showed keep an archive page once the vacancy closes. */
function cardPaths(rows: Awaited<ReturnType<typeof readPages>>): string[] {
  return rows
    .filter((row) => row.impressions > 0)
    .map((row) => new URL(row.keys[0] ?? '', SITE_ORIGIN).pathname)
    .filter((path) => parseVacancyPath(path) !== null);
}

/** The card copy is its own step: a failure there keeps the listing evidence. */
function recordCards(
  database: DatabaseSync,
  rows: Awaited<ReturnType<typeof readPages>>,
  log: SearchEvidenceLog,
  now: Date,
): number {
  try {
    return recordArchiveImpressions(database, cardPaths(rows), now);
  } catch (error: unknown) {
    log.error({ reason: failureReason(error) }, 'catalog-archive-impressions-failed');
    return 0;
  }
}

function writeEvidence(
  database: DatabaseSync,
  listings: ReadonlyArray<{ place: string; role: string }>,
  now: Date,
): void {
  database.exec(CATALOG_LISTING_SEARCH_EVIDENCE_TABLE_SQL);
  const upsert = database.prepare(
    `INSERT INTO catalog_listing_search_evidence (place_slug, role_slug, last_impression_at)
     VALUES (?, ?, ?)
     ON CONFLICT (place_slug, role_slug) DO UPDATE SET
       last_impression_at = excluded.last_impression_at`,
  );
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const listing of listings) upsert.run(listing.place, listing.role, now.toISOString());
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function failureReason(error: unknown): string {
  if (error instanceof Error && error.message.startsWith('http_')) return error.message;
  return error instanceof Error ? error.name : 'UnknownError';
}

/** A refused or failed read changes nothing: earlier evidence ages out by date. */
export async function refreshCatalogSearchEvidence(
  database: DatabaseSync,
  tokens: TokenSource,
  log: SearchEvidenceLog,
  fetcher: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<void> {
  try {
    const rows = await readPages(tokens, fetcher, now);
    const listings = listingKeys(rows);
    writeEvidence(database, listings, now);
    const cards = recordCards(database, rows, log, now);
    log.info(
      { pages: rows.length, listings: listings.length, cards },
      'catalog-search-evidence-written',
    );
  } catch (error: unknown) {
    log.error({ reason: failureReason(error) }, 'catalog-search-evidence-failed');
  }
}

/** Maintenance process only. The same key as the Indexing API notifier. */
export function scheduleCatalogSearchEvidence(
  database: DatabaseSync,
  rawKey: string | undefined,
  log: SearchEvidenceLog,
): () => void {
  const account = parseServiceAccount(rawKey?.trim() ?? '');
  if (!account) {
    log.info({}, 'catalog-search-evidence-off');
    return () => undefined;
  }
  const tokens = new VertexTokenProvider(account, fetch, Date.now, SEARCH_READ_SCOPE);
  const run = () => void refreshCatalogSearchEvidence(database, tokens, log);
  const first = setTimeout(run, FIRST_RUN_MS);
  const every = setInterval(run, INTERVAL_MS);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
