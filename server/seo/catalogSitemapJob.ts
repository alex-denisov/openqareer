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
  INDEXED_CARD_SUMMARY_MIN,
  INDEXED_PLACE_MIN,
  INDEXED_PLACE_ROLE_MIN,
} from './catalogIndexing';
import { CARD_POSTED_WITHIN_DAYS, CARD_SEEN_WITHIN_DAYS } from './catalogIndexing';
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

/** Same rule as `isIndexableCard`, in SQL; walks the `published_ms` index. */
function indexableJobs(database: DatabaseSync, now: Date): SitemapUrl[] {
  const rows = database
    .prepare(
      `SELECT path, published_at FROM catalog_entries
        WHERE status = 'active' AND path <> ''
          AND published_ms >= ? AND last_seen_ms >= ?
          AND salary_label IS NOT NULL AND salary_label <> ''
          AND length(trim(summary)) >= ?
          AND trim(company) <> '' AND role_slug IS NOT NULL
        ORDER BY published_ms DESC, entry_key ASC`,
    )
    .all(
      now.getTime() - CARD_POSTED_WITHIN_DAYS * DAY_MS,
      now.getTime() - CARD_SEEN_WITHIN_DAYS * DAY_MS,
      INDEXED_CARD_SUMMARY_MIN,
    ) as Array<{ path: string; published_at: string }>;
  return rows.map((row) => ({ path: row.path, lastmod: row.published_at.slice(0, 10) }));
}

/**
 * Indexable listings (`isIndexableListing`, same thresholds as the page's robots meta) with the date of
 * their freshest vacancy: a listing changes when a vacancy is added, and
 * `last_seen_at` moves for every row on every crawl, so it says nothing.
 */
function listings(database: DatabaseSync): SitemapUrl[] {
  const rows = database
    .prepare(
      `SELECT place_slug, NULL AS role_slug, count(*) AS count, max(published_at) AS freshest
         FROM catalog_entries
        WHERE status = 'active' AND path <> '' AND place_slug IS NOT NULL
        GROUP BY place_slug
       HAVING count(*) >= ?
        UNION ALL
       SELECT place_slug, role_slug, count(*) AS count, max(published_at) AS freshest
         FROM catalog_entries
        WHERE status = 'active' AND path <> ''
          AND place_slug IS NOT NULL AND role_slug IS NOT NULL
        GROUP BY place_slug, role_slug
       HAVING count(*) >= ?
        ORDER BY count DESC, place_slug ASC, role_slug ASC`,
    )
    .all(INDEXED_PLACE_MIN, INDEXED_PLACE_ROLE_MIN) as Array<{
    place_slug: string;
    role_slug: string | null;
    freshest: string;
  }>;
  return rows.flatMap((row) => {
    const path = listingPath(row.place_slug, row.role_slug ?? undefined);
    return path ? [{ path, lastmod: row.freshest.slice(0, 10) }] : [];
  });
}

export function computeCatalogSitemaps(database: DatabaseSync, now: Date): SitemapFile[] {
  return buildSitemapFiles({
    listings: [...listings(database), ...salaryMarketSitemapUrls(database)],
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
