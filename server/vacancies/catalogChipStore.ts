/**
 * B574: chip lists of the public catalog, materialized by the maintenance
 * process like `catalog_salary_stats`. One pass over `catalog_entries` decides
 * every chip of every list and writes
 * - `catalog_chip_counts`: one row per list with the count of each chip, so a
 *   page knows which chips to print with one primary-key read;
 * - `catalog_chip_entries`: the matching entries in page order, so a filtered
 *   page is an index range of `limit + 1` rows, never a scan of the list.
 * Both tables are created here, never by a startup migration.
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { salaryStatsKey } from './catalogSalaryStatsStore';
import {
  FRESH_WINDOW_MS,
  LISTING_CHIPS,
  RELOCATION_LIST_KEY,
  chipMatches,
  type CatalogChip,
  type ChipCounts,
} from './catalogChips';
import type { CatalogCursor } from './vacancyCatalogProjection';

const TABLES_SQL = `CREATE TABLE IF NOT EXISTS catalog_chip_counts (
  list_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  computed_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS catalog_chip_entries (
  list_key TEXT NOT NULL,
  chip TEXT NOT NULL,
  published_ms INTEGER NOT NULL,
  entry_key TEXT NOT NULL,
  PRIMARY KEY (list_key, chip, published_ms DESC, entry_key ASC)
) STRICT, WITHOUT ROWID`;

export interface ChipEntry {
  readonly listKey: string;
  readonly chip: CatalogChip;
  readonly publishedMs: number;
  readonly entryKey: string;
}

export interface ChipSnapshot {
  readonly counts: ReadonlyMap<string, ChipCounts>;
  readonly entries: readonly ChipEntry[];
}

interface SourceRow {
  entry_key: string;
  place_slug: string | null;
  role_slug: string | null;
  is_remote: number;
  salary_label: string | null;
  title: string;
  summary: string;
  published_ms: number;
}

function tableExists(database: DatabaseSync, name: string): boolean {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function listKeysOf(row: SourceRow): string[] {
  if (!row.place_slug) return [];
  const place = row.place_slug;
  return row.role_slug ? [place, salaryStatsKey({ place, role: row.role_slug })] : [place];
}

/** Maintenance process only: one scan of the materialized catalog. */
export function computeCatalogChips(database: DatabaseSync, nowMs: number): ChipSnapshot {
  const counts = new Map<string, ChipCounts>();
  const entries: ChipEntry[] = [];
  if (!tableExists(database, 'catalog_entries')) return { counts, entries };
  const rows = database
    .prepare(
      `SELECT entry_key, place_slug, role_slug, is_remote, salary_label, title, summary, published_ms
         FROM catalog_entries WHERE status = 'active' AND path <> ''`,
    )
    .all() as unknown as SourceRow[];
  const add = (listKey: string, chip: CatalogChip, row: SourceRow) => {
    entries.push({ listKey, chip, publishedMs: row.published_ms, entryKey: row.entry_key });
    const current = counts.get(listKey) ?? {};
    counts.set(listKey, { ...current, [chip]: (current[chip] ?? 0) + 1 });
  };
  for (const row of rows) {
    const fields = {
      isRemote: row.is_remote === 1,
      salaryLabel: row.salary_label,
      title: row.title,
      summary: row.summary,
      publishedMs: row.published_ms,
    };
    if (chipMatches('relocation', fields, nowMs)) add(RELOCATION_LIST_KEY, 'relocation', row);
    const lists = listKeysOf(row);
    for (const { id } of LISTING_CHIPS) {
      if (!chipMatches(id, fields, nowMs)) continue;
      for (const listKey of lists) add(listKey, id, row);
    }
  }
  return { counts, entries };
}

/** Both tables replaced in one transaction. */
export function writeCatalogChips(database: DatabaseSync, snapshot: ChipSnapshot, now: Date): void {
  database.exec(TABLES_SQL);
  const count = database.prepare(
    'INSERT INTO catalog_chip_counts (list_key, payload, computed_at) VALUES (?, ?, ?)',
  );
  const entry = database.prepare(
    'INSERT OR IGNORE INTO catalog_chip_entries (list_key, chip, published_ms, entry_key) VALUES (?, ?, ?, ?)',
  );
  database.exec('BEGIN');
  try {
    database.exec('DELETE FROM catalog_chip_counts; DELETE FROM catalog_chip_entries');
    const at = now.toISOString();
    for (const [key, value] of snapshot.counts) count.run(key, JSON.stringify(value), at);
    for (const row of snapshot.entries) {
      entry.run(row.listKey, row.chip, row.publishedMs, row.entryKey);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

/** Web request path: one row by primary key; empty until maintenance writes. */
export function readCatalogChipCounts(database: DatabaseSync, listKey: string): ChipCounts {
  if (!tableExists(database, 'catalog_chip_counts')) return {};
  const row = database
    .prepare('SELECT payload FROM catalog_chip_counts WHERE list_key = ?')
    .get(listKey) as { payload: string } | undefined;
  if (!row) return {};
  try {
    return JSON.parse(row.payload) as ChipCounts;
  } catch {
    return {};
  }
}

/**
 * Web request path: the entry keys of one chip page, by the primary-key range.
 * «За последние 3 дня» is re-checked against the clock: the list was written
 * up to half an hour ago.
 */
export function readCatalogChipKeys(
  database: DatabaseSync,
  query: { listKey: string; chip: CatalogChip; limit: number; after?: CatalogCursor },
  nowMs: number,
): { publishedMs: number; entryKey: string }[] {
  if (!tableExists(database, 'catalog_chip_entries')) return [];
  const where = ['list_key = ?', 'chip = ?'];
  const params: SQLInputValue[] = [query.listKey, query.chip];
  if (query.chip === 'fresh') {
    where.push('published_ms >= ?');
    params.push(nowMs - FRESH_WINDOW_MS);
  }
  if (query.after) {
    where.push('(published_ms < ? OR (published_ms = ? AND entry_key > ?))');
    params.push(query.after.publishedMs, query.after.publishedMs, query.after.key);
  }
  params.push(query.limit);
  return (
    database
      .prepare(
        `SELECT published_ms, entry_key FROM catalog_chip_entries WHERE ${where.join(' AND ')}
          ORDER BY published_ms DESC, entry_key ASC LIMIT ?`,
      )
      .all(...params) as unknown as { published_ms: number; entry_key: string }[]
  ).map((row) => ({ publishedMs: row.published_ms, entryKey: row.entry_key }));
}
