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
import { pauseClusterWrite } from './clusterWritePause';
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

type ChipWrite = () => void;

const CHIP_WRITE_BUDGET_MS = 100;

export interface ChipWriteOptions {
  readonly budgetMs?: number;
  readonly pause?: () => void;
}

export interface ChipWriteReport {
  readonly entriesAdded: number;
  readonly entriesRemoved: number;
  readonly countsChanged: number;
  readonly transactions: number;
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

const entryId = (row: ChipEntry): string =>
  `${row.listKey}\0${row.chip}\0${row.publishedMs}\0${row.entryKey}`;

/** Новые строки идут первыми: сохранённая запись не пропадает у читателя ни на одном коммите. */
function entryWrites(database: DatabaseSync, snapshot: ChipSnapshot) {
  const stored = database
    .prepare(
      `SELECT list_key AS listKey, chip, published_ms AS publishedMs, entry_key AS entryKey
         FROM catalog_chip_entries`,
    )
    .iterate() as Iterable<ChipEntry>;
  const insert = database.prepare(
    'INSERT OR IGNORE INTO catalog_chip_entries (list_key, chip, published_ms, entry_key) VALUES (?, ?, ?, ?)',
  );
  const remove = database.prepare(
    `DELETE FROM catalog_chip_entries
      WHERE list_key = ? AND chip = ? AND published_ms = ? AND entry_key = ?`,
  );
  const missing = new Map<string, ChipEntry>();
  for (const row of snapshot.entries) missing.set(entryId(row), row);
  const removed: ChipEntry[] = [];
  for (const row of stored) if (!missing.delete(entryId(row))) removed.push(row);
  const write =
    (statement: typeof insert) =>
    (row: ChipEntry): ChipWrite =>
    () => {
      statement.run(row.listKey, row.chip, row.publishedMs, row.entryKey);
    };
  return { added: Array.from(missing.values(), write(insert)), removed: removed.map(write(remove)) };
}

function countWrites(database: DatabaseSync, snapshot: ChipSnapshot, at: string): ChipWrite[] {
  const stored = database
    .prepare('SELECT list_key AS listKey, payload FROM catalog_chip_counts')
    .all() as unknown as { listKey: string; payload: string }[];
  const payloads = new Map(stored.map((row) => [row.listKey, row.payload]));
  const upsert = database.prepare(
    `INSERT INTO catalog_chip_counts (list_key, payload, computed_at) VALUES (?, ?, ?)
       ON CONFLICT (list_key) DO UPDATE SET payload = excluded.payload, computed_at = excluded.computed_at`,
  );
  const remove = database.prepare('DELETE FROM catalog_chip_counts WHERE list_key = ?');
  const changed = Array.from(snapshot.counts, ([key, value]) => [key, JSON.stringify(value)] as const)
    .filter(([key, payload]) => payloads.get(key) !== payload)
    .map(([key, payload]): ChipWrite => () => void upsert.run(key, payload, at));
  const gone = stored
    .filter((row) => !snapshot.counts.has(row.listKey))
    .map((row): ChipWrite => () => void remove.run(row.listKey));
  return [...changed, ...gone];
}

function writeInPortions(
  database: DatabaseSync,
  writes: readonly ChipWrite[],
  { budgetMs, pause }: Required<ChipWriteOptions>,
): number {
  let position = 0;
  let transactions = 0;
  while (position < writes.length) {
    if (position > 0) pause();
    database.exec('BEGIN IMMEDIATE');
    try {
      const startedAt = performance.now();
      do {
        writes[position]!();
        position += 1;
      } while (position < writes.length && performance.now() - startedAt < budgetMs);
      database.exec('COMMIT');
      transactions += 1;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  return transactions;
}

/**
 * Пишет только разницу со снимком короткими транзакциями (PRB-041): полная
 * перезапись 274 тыс. строк держала блокировку до 3,7 с и останавливала чтения
 * HTTP. Во время записи страница может на секунды показать смесь старых и новых
 * строк; список и так отстаёт до получаса. Прерванный проход доделает следующий.
 */
export function writeCatalogChips(
  database: DatabaseSync,
  snapshot: ChipSnapshot,
  now: Date,
  { budgetMs = CHIP_WRITE_BUDGET_MS, pause = pauseClusterWrite }: ChipWriteOptions = {},
): ChipWriteReport {
  database.exec(TABLES_SQL);
  const { added, removed } = entryWrites(database, snapshot);
  const counts = countWrites(database, snapshot, now.toISOString());
  const transactions = writeInPortions(database, [...added, ...removed, ...counts], {
    budgetMs,
    pause,
  });
  return {
    entriesAdded: added.length,
    entriesRemoved: removed.length,
    countsChanged: counts.length,
    transactions,
  };
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
