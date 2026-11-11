/**
 * Archive pages for closed vacancies (owner, 11.11; the hh.ru model, hybrid).
 *
 * A closed card used to answer 410. A card search engines already know — it was
 * in our sitemap or Google showed it — now keeps a page marked «В архиве»; every
 * other closed card still answers 410, so we neither copy foreign texts for
 * nothing nor spend crawl budget on them.
 *
 * `catalog_entries` cannot hold the archive: archiving clears the row's summary
 * (prod 11.11: 10 347 archived rows, every summary empty) and pruning the pool
 * deletes the row. So the maintenance process copies each sitemap card here once
 * a day, and the Search Console read marks cards with impressions. The web
 * server reads one primary-key row per closed card's request.
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { parseVacancyPath } from '../../shared/vacancyCatalogRoutes';
import { applySqliteBusyTimeout, SQLITE_HTTP_BUSY_TIMEOUT_MS } from '../data/sqliteBusyTimeout';

export const CATALOG_ARCHIVE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS catalog_archive_cards (
  entry_key TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  is_remote INTEGER NOT NULL,
  salary_label TEXT,
  summary TEXT NOT NULL,
  source_name TEXT,
  published_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  place_slug TEXT,
  place_label TEXT,
  role_slug TEXT,
  role_label TEXT,
  last_listed_at TEXT,
  last_impression_at TEXT
) STRICT, WITHOUT ROWID`;

/** Closed longer than this and unseen in search for `IMPRESSION_FRESH_DAYS`: 410. */
export const ARCHIVE_MAX_AGE_DAYS = 180;
export const ARCHIVE_IMPRESSION_FRESH_DAYS = 90;
const DAY_MS = 86_400_000;

export interface CatalogArchiveCard {
  readonly entryKey: string;
  readonly path: string;
  readonly title: string;
  readonly company: string;
  readonly location?: string;
  readonly isRemote: boolean;
  readonly salaryLabel?: string;
  readonly summary: string;
  readonly sourceName?: string;
  readonly publishedAt: string;
  readonly lastSeenAt: string;
  readonly placeSlug?: string;
  readonly placeLabel?: string;
  readonly roleSlug?: string;
  readonly roleLabel?: string;
  readonly lastListedAt?: string;
  readonly lastImpressionAt?: string;
}

/**
 * Copies the catalog row; a later copy never replaces a kept text with an empty
 * one, so the text survives the archiving that clears it.
 */
const COPY_FROM_CATALOG_SQL = `INSERT INTO catalog_archive_cards (
    entry_key, path, title, company, location, is_remote, salary_label, summary,
    source_name, published_at, last_seen_at, place_slug, place_label, role_slug,
    role_label, last_listed_at, last_impression_at)
  SELECT entry_key, path, title, company, location, is_remote, salary_label, summary,
         source_name, published_at, last_seen_at, place_slug, place_label, role_slug,
         role_label, ?1, ?2
    FROM catalog_entries WHERE entry_key = ?3 AND path <> ''
  ON CONFLICT (entry_key) DO UPDATE SET
    path = excluded.path,
    title = excluded.title,
    company = excluded.company,
    location = excluded.location,
    is_remote = excluded.is_remote,
    salary_label = coalesce(excluded.salary_label, salary_label),
    summary = CASE WHEN length(trim(excluded.summary)) > 0 THEN excluded.summary ELSE summary END,
    source_name = coalesce(excluded.source_name, source_name),
    published_at = excluded.published_at,
    last_seen_at = max(last_seen_at, excluded.last_seen_at),
    place_slug = excluded.place_slug,
    place_label = excluded.place_label,
    role_slug = excluded.role_slug,
    role_label = excluded.role_label,
    last_listed_at = coalesce(excluded.last_listed_at, last_listed_at),
    last_impression_at = coalesce(excluded.last_impression_at, last_impression_at)`;

function inTransaction(database: DatabaseSync, work: () => void): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    work();
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function keysOf(paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => parseVacancyPath(path)).filter((key) => key !== null))];
}

/** The day's sitemap cards; once a UTC day is enough (`snapshotDue`). */
export function snapshotSitemapCards(
  database: DatabaseSync,
  paths: readonly string[],
  now: Date,
): number {
  database.exec(CATALOG_ARCHIVE_TABLE_SQL);
  const copy = database.prepare(COPY_FROM_CATALOG_SQL);
  const at = now.toISOString();
  let copied = 0;
  inTransaction(database, () => {
    for (const key of keysOf(paths)) copied += Number(copy.run(at, null, key).changes);
    // A copy that can only answer 410 any more is dropped, so the table stays bounded.
    database
      .prepare(
        `DELETE FROM catalog_archive_cards
          WHERE last_seen_at < ? AND (last_impression_at IS NULL OR last_impression_at < ?)`,
      )
      .run(
        new Date(now.getTime() - ARCHIVE_MAX_AGE_DAYS * DAY_MS).toISOString(),
        new Date(now.getTime() - ARCHIVE_IMPRESSION_FRESH_DAYS * DAY_MS).toISOString(),
      );
  });
  return copied;
}

/** True when no card was listed today yet: the sitemap job runs every 30 minutes. */
export function snapshotDue(database: DatabaseSync, now: Date): boolean {
  database.exec(CATALOG_ARCHIVE_TABLE_SQL);
  const row = database
    .prepare('SELECT max(last_listed_at) AS last FROM catalog_archive_cards')
    .get() as { last: string | null };
  return !row.last || row.last.slice(0, 10) < now.toISOString().slice(0, 10);
}

/** Card pages Search Console showed; a card already gone from the catalog keeps its copy. */
export function recordArchiveImpressions(
  database: DatabaseSync,
  paths: readonly string[],
  now: Date,
): number {
  database.exec(CATALOG_ARCHIVE_TABLE_SQL);
  const copy = database.prepare(COPY_FROM_CATALOG_SQL);
  const mark = database.prepare(
    'UPDATE catalog_archive_cards SET last_impression_at = ? WHERE entry_key = ?',
  );
  const at = now.toISOString();
  let marked = 0;
  inTransaction(database, () => {
    for (const key of keysOf(paths)) {
      const copied = Number(copy.run(null, at, key).changes);
      marked += copied > 0 ? copied : Number(mark.run(at, key).changes);
    }
  });
  return marked;
}

function daysBetween(later: Date, earlier: string | undefined): number {
  const time = earlier ? Date.parse(earlier) : Number.NaN;
  return Number.isFinite(time) ? (later.getTime() - time) / DAY_MS : Number.POSITIVE_INFINITY;
}

/** 200 «В архиве» or 410; the page is never for a card nobody has seen. */
export function archivePageDecision(
  card: CatalogArchiveCard | undefined,
  now: Date,
): 'archive' | 'gone' {
  if (!card || (!card.lastListedAt && !card.lastImpressionAt)) return 'gone';
  const closedDays = daysBetween(now, card.lastSeenAt);
  const impressionDays = daysBetween(now, card.lastImpressionAt);
  return closedDays > ARCHIVE_MAX_AGE_DAYS && impressionDays > ARCHIVE_IMPRESSION_FRESH_DAYS
    ? 'gone'
    : 'archive';
}

interface ArchiveRow {
  entry_key: string;
  path: string;
  title: string;
  company: string;
  location: string | null;
  is_remote: number;
  salary_label: string | null;
  summary: string;
  source_name: string | null;
  published_at: string;
  last_seen_at: string;
  place_slug: string | null;
  place_label: string | null;
  role_slug: string | null;
  role_label: string | null;
  last_listed_at: string | null;
  last_impression_at: string | null;
}

function optional<K extends string>(key: K, value: string | null): { [P in K]?: string } {
  return (value ? { [key]: value } : {}) as { [P in K]?: string };
}

function cardOfRow(row: ArchiveRow): CatalogArchiveCard {
  return {
    entryKey: row.entry_key,
    path: row.path,
    title: row.title,
    company: row.company,
    isRemote: row.is_remote === 1,
    summary: row.summary,
    publishedAt: row.published_at,
    lastSeenAt: row.last_seen_at,
    ...optional('location', row.location),
    ...optional('salaryLabel', row.salary_label),
    ...optional('sourceName', row.source_name),
    ...optional('placeSlug', row.place_slug),
    ...optional('placeLabel', row.place_label),
    ...optional('roleSlug', row.role_slug),
    ...optional('roleLabel', row.role_label),
    ...optional('lastListedAt', row.last_listed_at),
    ...optional('lastImpressionAt', row.last_impression_at),
  };
}

const readers = new Map<string, { database: DatabaseSync; statement: StatementSync }>();
let failureLogged = false;

function reader(databasePath: string) {
  const open = readers.get(databasePath);
  if (open?.database.isOpen) return open;
  const database = new DatabaseSync(databasePath, { readOnly: true });
  applySqliteBusyTimeout(database, SQLITE_HTTP_BUSY_TIMEOUT_MS);
  const statement = database.prepare('SELECT * FROM catalog_archive_cards WHERE entry_key = ?');
  const created = { database, statement };
  readers.set(databasePath, created);
  return created;
}

/** Test seam: tests delete their database files between cases. */
export function closeCatalogArchiveReaders(): void {
  for (const { database } of readers.values()) if (database.isOpen) database.close();
  readers.clear();
}

function isMissingTable(error: unknown): boolean {
  return error instanceof Error && /no such table/u.test(error.message);
}

/** Undefined on any failure: the request then answers 410, as before the archive. */
export function readCatalogArchiveCard(
  databasePath: string,
  entryKey: string,
): CatalogArchiveCard | undefined {
  if (databasePath === ':memory:') return undefined;
  try {
    const row = reader(databasePath).statement.get(entryKey) as ArchiveRow | undefined;
    return row ? cardOfRow(row) : undefined;
  } catch (error: unknown) {
    closeCatalogArchiveReaders();
    if (!isMissingTable(error) && !failureLogged) {
      failureLogged = true;
      process.emitWarning(
        `catalog-archive-read-failed: ${error instanceof Error ? error.name : 'UnknownError'}`,
      );
    }
    return undefined;
  }
}
