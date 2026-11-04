/**
 * Which place and place+role listings have existed and when they last met the
 * index threshold (03.11).
 *
 * Catalog rows are deleted when a vacancy goes, so without this table an
 * emptied listing and a path that never existed looked the same (410), and a
 * listing hovering around its threshold flipped index/noindex/410 daily. The
 * maintenance process writes it with the sitemap files; the web server keeps
 * a copy in memory, so the HTTP path never reads it from disk.
 */
import type { DatabaseSync } from 'node:sqlite';
import { MIN_LISTING_SIZE } from '../vacancies/vacancyCatalogFacets';
import { listingQualifies, type ListingIndexHistory } from './catalogIndexing';

export const CATALOG_LISTING_HISTORY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS catalog_listing_history (
  place_slug TEXT NOT NULL,
  role_slug TEXT NOT NULL DEFAULT '',
  first_published_at TEXT NOT NULL,
  first_qualified_at TEXT,
  last_qualified_at TEXT,
  PRIMARY KEY (place_slug, role_slug)
) STRICT, WITHOUT ROWID`;

/** Written by `catalogSearchEvidence`; a listing may be here and not in the history above. */
export const CATALOG_LISTING_SEARCH_EVIDENCE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS catalog_listing_search_evidence (
  place_slug TEXT NOT NULL,
  role_slug TEXT NOT NULL DEFAULT '',
  last_impression_at TEXT NOT NULL,
  PRIMARY KEY (place_slug, role_slug)
) STRICT, WITHOUT ROWID`;

export interface ListingCount {
  readonly place: string;
  readonly role?: string;
  readonly count: number;
}

export type ListingHistoryMap = ReadonlyMap<string, ListingIndexHistory>;

export function listingHistoryKey(place: string, role?: string): string {
  return `${place}/${role ?? ''}`;
}

/**
 * A listing is recorded once it is published (linked from the catalog's
 * filters, `MIN_LISTING_SIZE`); a qualifying one also moves its qualified dates.
 */
export function recordListingHistory(
  database: DatabaseSync,
  counts: readonly ListingCount[],
  now: Date,
): void {
  database.exec(CATALOG_LISTING_HISTORY_TABLE_SQL);
  const at = now.toISOString();
  const upsert = database.prepare(
    `INSERT INTO catalog_listing_history
       (place_slug, role_slug, first_published_at, first_qualified_at, last_qualified_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (place_slug, role_slug) DO UPDATE SET
       first_qualified_at = coalesce(first_qualified_at, excluded.first_qualified_at),
       last_qualified_at = coalesce(excluded.last_qualified_at, last_qualified_at)`,
  );
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const listing of counts) {
      if (listing.count < MIN_LISTING_SIZE) continue;
      const qualified = listingQualifies(listing.count, listing.role !== undefined) ? at : null;
      upsert.run(listing.place, listing.role ?? '', at, qualified, qualified);
    }
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function tableExists(database: DatabaseSync, name: string): boolean {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function readImpressions(database: DatabaseSync): Map<string, string> {
  if (!tableExists(database, 'catalog_listing_search_evidence')) return new Map();
  const rows = database
    .prepare('SELECT place_slug, role_slug, last_impression_at FROM catalog_listing_search_evidence')
    .all() as Array<{ place_slug: string; role_slug: string; last_impression_at: string }>;
  return new Map(
    rows.map((row) => [
      listingHistoryKey(row.place_slug, row.role_slug || undefined),
      row.last_impression_at,
    ]),
  );
}

/** Empty when the maintenance process has not created the tables yet. */
export function readListingHistory(database: DatabaseSync): Map<string, ListingIndexHistory> {
  const impressions = readImpressions(database);
  const rows = tableExists(database, 'catalog_listing_history')
    ? (database
        .prepare(
          'SELECT place_slug, role_slug, first_qualified_at, last_qualified_at FROM catalog_listing_history',
        )
        .all() as Array<{
        place_slug: string;
        role_slug: string;
        first_qualified_at: string | null;
        last_qualified_at: string | null;
      }>)
    : [];
  const history = new Map<string, ListingIndexHistory>(
    [...impressions].map(([key, lastImpressionAt]) => [key, { lastImpressionAt }]),
  );
  for (const row of rows) {
    const key = listingHistoryKey(row.place_slug, row.role_slug || undefined);
    history.set(key, {
      ...(row.first_qualified_at ? { firstQualifiedAt: row.first_qualified_at } : {}),
      ...(row.last_qualified_at ? { lastQualifiedAt: row.last_qualified_at } : {}),
      ...history.get(key),
    });
  }
  return history;
}
