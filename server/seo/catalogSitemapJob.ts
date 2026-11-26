/**
 * Builds the sitemap child files in the maintenance process (SEO review, 20.10).
 *
 * The listings query groups every active catalog row (~1 s on the prod pool,
 * 20.10), so it never runs on the web server's event loop. The result is a few
 * rows in `catalog_sitemaps`; the web server reads them every few minutes and
 * serves files from memory, like `landing_stats` (B535).
 */
import type { DatabaseSync } from 'node:sqlite';
import { inWriteTransaction, writeInPortions } from '../data/writePortions';
import { VACANCY_CLUSTERS_TABLE } from '../data/sqliteSchema';
import { salaryMarketSitemapUrls } from './salaryMarketSitemap';
import { marketReportPages } from './marketReport';
import { countryCatalogFrom } from '../salaryMarket/countryCatalog';
import { SEARCH_RESTRICTED_JSON_NEEDLES } from './searchRestrictedSources';
import { listingPath } from '../../shared/vacancyCatalogRoutes';
import {
  INDEXED_CARD_SUMMARY_MIN,
  SITEMAP_CARD_SEEN_WITHIN_DAYS,
  listingQualifies,
} from './catalogIndexing';
import { recordListingHistory, type ListingCount } from './catalogListingHistory';
import { CATALOG_CARD_ROLLOUT_TABLE_SQL } from './catalogCardRollout';
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

/**
 * B776: одна строка о сборке файлов. Веб-процесс сверяет её, а не строки catalog_sitemaps:
 * их столбцы лежат после 17 МБ xml, и подпись по ним шла 0,5 с цикла событий (прод 23.11).
 */
export const CATALOG_SITEMAPS_BUILD_TABLE_SQL = `CREATE TABLE IF NOT EXISTS catalog_sitemaps_build (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  signature TEXT NOT NULL
) STRICT`;

function buildSignature(files: readonly SitemapFile[], now: Date): string {
  const at = now.toISOString();
  return files.map((file) => `${file.name}:${file.urlCount}:${file.lastmod ?? ''}:${at}`).join('|');
}

const DAY_MS = 86_400_000;

/**
 * Same rule as `isIndexableCard`, in SQL: live (seen within the window) and
 * passing the quality rules. `GLOB '*[1-9]*'` is `hasKnownSalary`: a stored
 * «0 $» is no salary. A card in `catalog_card_rollout` needs no salary. No
 * withdrawal date is stored here; a withdrawn vacancy leaves the active set.
 */
function indexableJobs(database: DatabaseSync, now: Date): SitemapUrl[] {
  const restricted = SEARCH_RESTRICTED_JSON_NEEDLES.map(() => 'instr(c.cluster_json, ?) > 0').join(
    ' OR ',
  );
  const rows = database
    .prepare(
      // No cluster row means the sources are unknown, so the card counts as restricted.
      `SELECT path, published_at,
              coalesce((SELECT ${restricted} FROM vacancy_clusters c
                         WHERE c.id = catalog_entries.cluster_id), 1) AS restricted
         FROM catalog_entries
        WHERE status = 'active' AND path <> ''
          AND last_seen_ms >= ?
          AND (EXISTS (SELECT 1 FROM catalog_card_rollout r
                        WHERE r.cluster_id = catalog_entries.cluster_id)
               OR length(trim(summary)) >= ?
               OR EXISTS (SELECT 1 FROM catalog_ru_summaries s
                           WHERE s.cluster_id = catalog_entries.cluster_id
                             AND s.status = 'ready' AND s.version = ?))
          AND trim(company) <> '' AND role_slug IS NOT NULL
        ORDER BY published_ms DESC, entry_key ASC`,
    )
    .all(
      ...SEARCH_RESTRICTED_JSON_NEEDLES,
      now.getTime() - SITEMAP_CARD_SEEN_WITHIN_DAYS * DAY_MS,
      INDEXED_CARD_SUMMARY_MIN,
      CATALOG_RU_SUMMARY_VERSION,
    ) as Array<{
    path: string;
    published_at: string;
    restricted: number;
  }>;
  return rows.map((row) => ({
    path: row.path,
    lastmod: row.published_at.slice(0, 10),
    ...(row.restricted ? { noIndexingApi: true as const } : {}),
  }));
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
function listings(
  database: DatabaseSync,
  now: Date,
  writer: DatabaseSync,
  pause: () => void,
): SitemapUrl[] {
  const counts = listingCounts(database);
  recordListingHistory(writer, counts, now, pause);
  // 11.11: only listings at their threshold; a thin list is not offered to search.
  return counts.flatMap((row) => {
    if (!listingQualifies(row.count, row.role !== undefined)) return [];
    const path = listingPath(row.place, row.role);
    return path ? [{ path, lastmod: row.freshest.slice(0, 10) }] : [];
  });
}

/**
 * Also records which listings exist and qualify (`catalog_listing_history`): that and the
 * tables other jobs create on their first tick go through `writer`, because in the worker
 * `database` is read-only.
 */
export function computeCatalogSitemaps(
  database: DatabaseSync,
  now: Date,
  writer: DatabaseSync = database,
  pause: () => void = () => undefined,
): SitemapFile[] {
  writer.exec(CATALOG_RU_SUMMARIES_TABLE_SQL);
  writer.exec(CATALOG_CARD_ROLLOUT_TABLE_SQL);
  writer.exec(VACANCY_CLUSTERS_TABLE);
  return buildSitemapFiles({
    listings: [
      ...listings(database, now, writer, pause),
      ...salaryMarketSitemapUrls(database, (code) => countryCatalogFrom(database, code)),
    ],
    jobs: indexableJobs(database, now),
    extraPages: marketReportPages(database),
  });
}

/**
 * One file per transaction: the set is ~40 MB, and one transaction would hold the write lock.
 * The build signature and the removal of stale files go last, so the web server re-reads the
 * set only when it is complete.
 */
export function writeCatalogSitemaps(
  database: DatabaseSync,
  files: readonly SitemapFile[],
  now: Date,
  pause: () => void = () => undefined,
): void {
  database.exec(CATALOG_SITEMAPS_TABLE_SQL);
  const at = now.toISOString();
  const upsert = database.prepare(
    `INSERT INTO catalog_sitemaps (name, position, xml, url_count, lastmod, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET position = excluded.position, xml = excluded.xml,
       url_count = excluded.url_count, lastmod = excluded.lastmod, updated_at = excluded.updated_at`,
  );
  const rows = files.map((file, position) => ({ file, position }));
  writeInPortions(database, rows, 1, pause, ({ file, position }) => {
    upsert.run(file.name, position, file.xml, file.urlCount, file.lastmod ?? null, at);
  });
  pause();
  inWriteTransaction(database, () => {
    database
      .prepare('DELETE FROM catalog_sitemaps WHERE name NOT IN (SELECT value FROM json_each(?))')
      .run(JSON.stringify(files.map((file) => file.name)));
    // Created with its row: an empty build table would leave a restarted web server without files.
    database.exec(CATALOG_SITEMAPS_BUILD_TABLE_SQL);
    database
      .prepare('INSERT OR REPLACE INTO catalog_sitemaps_build (id, signature) VALUES (1, ?)')
      .run(buildSignature(files, now));
  });
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
