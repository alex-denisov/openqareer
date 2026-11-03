/**
 * Builds the sitemap child files in the maintenance process (SEO review, 20.10).
 *
 * The listings query groups every active catalog row (~1 s on the prod pool,
 * 20.10), so it never runs on the web server's event loop. The result is a few
 * rows in `catalog_sitemaps`; the web server reads them every few minutes and
 * serves files from memory, like `landing_stats` (B535).
 */
import type { DatabaseSync } from 'node:sqlite';
import { salaryMarketSitemapUrls } from './salaryMarketSitemap';
import { listingPath } from '../../shared/vacancyCatalogRoutes';
import {
  CARD_SEEN_WITHIN_DAYS,
  INDEXED_CARD_SUMMARY_MIN,
  isIndexableListing,
} from './catalogIndexing';
import {
  listingHistoryKey,
  readListingHistory,
  recordListingHistory,
  type ListingCount,
} from './catalogListingHistory';
import { CATALOG_RU_SUMMARY_VERSION } from './catalogRuSummary';
import { CATALOG_RU_SUMMARIES_TABLE_SQL } from './catalogRuSummaryStore';
import { buildSitemapFiles, type SitemapFile, type SitemapUrl } from './sitemapXml';

export const CATALOG_SITEMAPS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS catalog_sitemaps (
  name TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  xml TEXT NOT NULL,
  url_count INTEGER NOT NULL,
  lastmod TEXT,
  updated_at TEXT NOT NULL
) STRICT`;

const DAY_MS = 86_400_000;

/**
 * Same rule as `isIndexableCard`, in SQL: live (seen within the window) and
 * passing the quality rules. `GLOB '*[1-9]*'` is `hasKnownSalary`: a stored
 * «0 $» is no salary. No withdrawal date is stored here; a withdrawn vacancy
 * leaves the active set.
 */
function indexableJobs(database: DatabaseSync, now: Date): SitemapUrl[] {
  // The summary job creates the table on its first tick; the sitemap may run before it.
  database.exec(CATALOG_RU_SUMMARIES_TABLE_SQL);
  const rows = database
    .prepare(
      `SELECT path, published_at FROM catalog_entries
        WHERE status = 'active' AND path <> ''
          AND last_seen_ms >= ?
          AND salary_label IS NOT NULL AND salary_label GLOB '*[1-9]*'
          AND (length(trim(summary)) >= ?
               OR EXISTS (SELECT 1 FROM catalog_ru_summaries s
                           WHERE s.cluster_id = catalog_entries.cluster_id
                             AND s.status = 'ready' AND s.version = ?))
          AND trim(company) <> '' AND role_slug IS NOT NULL
        ORDER BY published_ms DESC, entry_key ASC`,
    )
    .all(
      now.getTime() - CARD_SEEN_WITHIN_DAYS * DAY_MS,
      INDEXED_CARD_SUMMARY_MIN,
      CATALOG_RU_SUMMARY_VERSION,
    ) as Array<{
    path: string;
    published_at: string;
  }>;
  return rows.map((row) => ({ path: row.path, lastmod: row.published_at.slice(0, 10) }));
}

interface ListingRow extends ListingCount {
  readonly freshest: string;
}

function listingCounts(database: DatabaseSync): ListingRow[] {
  const rows = database
    .prepare(
      `SELECT place_slug, NULL AS role_slug, count(*) AS count, max(published_at) AS freshest
         FROM catalog_entries
        WHERE status = 'active' AND path <> '' AND place_slug IS NOT NULL
        GROUP BY place_slug
        UNION ALL
       SELECT place_slug, role_slug, count(*) AS count, max(published_at) AS freshest
         FROM catalog_entries
        WHERE status = 'active' AND path <> ''
          AND place_slug IS NOT NULL AND role_slug IS NOT NULL
        GROUP BY place_slug, role_slug
        ORDER BY count DESC, place_slug ASC, role_slug ASC`,
    )
    .all() as Array<{
    place_slug: string;
    role_slug: string | null;
    count: number;
    freshest: string;
  }>;
  return rows.map((row) => ({
    place: row.place_slug,
    ...(row.role_slug ? { role: row.role_slug } : {}),
    count: row.count,
    freshest: row.freshest,
  }));
}

/**
 * Indexable listings (`isIndexableListing`, the same rule as the page's robots
 * meta, with the hysteresis history) and the date of their freshest vacancy: a
 * listing changes when a vacancy is added, and `last_seen_at` moves for every
 * row on every crawl, so it says nothing. Records the history first.
 */
function listings(database: DatabaseSync, now: Date): SitemapUrl[] {
  const counts = listingCounts(database);
  recordListingHistory(database, counts, now);
  const history = readListingHistory(database);
  return counts.flatMap((row) => {
    const known = history.get(listingHistoryKey(row.place, row.role));
    if (!isIndexableListing(row.count, row.role !== undefined, known, now)) return [];
    const path = listingPath(row.place, row.role);
    return path ? [{ path, lastmod: row.freshest.slice(0, 10) }] : [];
  });
}

/** Also records which listings exist and qualify (`catalog_listing_history`). */
export function computeCatalogSitemaps(database: DatabaseSync, now: Date): SitemapFile[] {
  return buildSitemapFiles({
    listings: [...listings(database, now), ...salaryMarketSitemapUrls(database)],
    jobs: indexableJobs(database, now),
  });
}

/** Replaces the whole set at once, so a shrunk job list leaves no stale file. */
export function writeCatalogSitemaps(
  database: DatabaseSync,
  files: readonly SitemapFile[],
  now: Date,
): void {
  database.exec(CATALOG_SITEMAPS_TABLE_SQL);
  const insert = database.prepare(
    `INSERT INTO catalog_sitemaps (name, position, xml, url_count, lastmod, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec('DELETE FROM catalog_sitemaps');
    files.forEach((file, position) => {
      insert.run(
        file.name,
        position,
        file.xml,
        file.urlCount,
        file.lastmod ?? null,
        now.toISOString(),
      );
    });
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
}

/** Null when the maintenance process has not written the files yet. */
export function readCatalogSitemaps(database: DatabaseSync): SitemapFile[] | null {
  const exists = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'catalog_sitemaps'")
    .get();
  if (!exists) return null;
  const rows = database
    .prepare('SELECT name, xml, url_count, lastmod FROM catalog_sitemaps ORDER BY position')
    .all() as Array<{ name: string; xml: string; url_count: number; lastmod: string | null }>;
  if (rows.length === 0) return null;
  return rows.map((row) => ({
    name: row.name,
    xml: row.xml,
    urlCount: row.url_count,
    ...(row.lastmod ? { lastmod: row.lastmod } : {}),
  }));
}
