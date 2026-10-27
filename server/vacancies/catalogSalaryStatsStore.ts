/**
 * B569: salary facts of every public list («N с зарплатой, из них M с вилкой»,
 * медиана). A city without a role reads 22 088 labels in 92 ms on prod (28.10),
 * too slow for the web event loop, so the maintenance process parses all lists
 * in one pass and writes a row per list; the web server reads one row by
 * primary key per page.
 */
import type { DatabaseSync } from 'node:sqlite';
import { readSalaryMarketIndex } from '../salaryMarket/salaryMarketSnapshot';
import { salaryStats, type SalaryStats } from './catalogSalaryStats';

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS catalog_salary_stats (
  list_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  computed_at TEXT NOT NULL
) STRICT`;

/** `place` or `place|role`, as the listing routes address a list. */
export function salaryStatsKey(query: { place: string; role?: string }): string {
  return query.role ? `${query.place}|${query.role}` : query.place;
}

function push(map: Map<string, string[]>, key: string, label: string): void {
  const labels = map.get(key);
  if (labels) labels.push(label);
  else map.set(key, [label]);
}

/** Maintenance process only: one scan of the materialized catalog (0.4 s on prod, 28.10). */
export function computeCatalogSalaryStats(database: DatabaseSync): Map<string, SalaryStats> {
  const result = new Map<string, SalaryStats>();
  const exists = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'catalog_entries'")
    .get();
  if (!exists) return result;
  const rows = database
    .prepare(
      `SELECT place_slug, role_slug, salary_label FROM catalog_entries
        WHERE status = 'active' AND path <> '' AND place_slug IS NOT NULL
          AND salary_label IS NOT NULL AND salary_label <> ''`,
    )
    .all() as Array<{ place_slug: string; role_slug: string | null; salary_label: string }>;
  const byList = new Map<string, string[]>();
  for (const row of rows) {
    push(byList, row.place_slug, row.salary_label);
    if (row.role_slug) push(byList, `${row.place_slug}|${row.role_slug}`, row.salary_label);
  }
  // A role page exists only for roles in the prepared salary directory.
  const salaryRoles = new Set(readSalaryMarketIndex(database).map((entry) => entry.role));
  for (const [key, labels] of byList) {
    const stats = salaryStats(labels);
    if (stats.withSalary === 0) continue;
    const role = key.split('|')[1];
    result.set(key, role && salaryRoles.has(role) ? { ...stats, salaryPage: true } : stats);
  }
  return result;
}

/** One row per list, replaced in one transaction. */
export function writeCatalogSalaryStats(
  database: DatabaseSync,
  stats: ReadonlyMap<string, SalaryStats>,
  now: Date,
): void {
  database.exec(TABLE_SQL);
  const insert = database.prepare(
    'INSERT INTO catalog_salary_stats (list_key, payload, computed_at) VALUES (?, ?, ?)',
  );
  database.exec('BEGIN');
  try {
    database.exec('DELETE FROM catalog_salary_stats');
    for (const [key, value] of stats) insert.run(key, JSON.stringify(value), now.toISOString());
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

/** Web request path: a primary-key read of one list; undefined until maintenance writes. */
export function readCatalogSalaryStats(
  database: DatabaseSync,
  query: { place: string; role?: string },
): SalaryStats | undefined {
  const exists = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'catalog_salary_stats'")
    .get();
  if (!exists) return undefined;
  const row = database
    .prepare('SELECT payload FROM catalog_salary_stats WHERE list_key = ?')
    .get(salaryStatsKey(query)) as { payload: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.payload) as SalaryStats;
  } catch {
    return undefined;
  }
}
