import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { tableExists } from './clusterSplit';

/**
 * B752: журнал разбиения. Перед записью кусков шаг снимает прежнее состояние
 * всех затронутых id (строка кластера, ключи, строки каталога), откат кладёт
 * его обратно строка в строку, с прежними rowid.
 */

/** Строки каталога, привязанные к id кластера. `rowid` — у таблиц с ним. */
export const CATALOG_CLUSTER_TABLES: readonly { table: string; rowid: boolean }[] = [
  { table: 'catalog_entries', rowid: true },
  { table: 'catalog_entries_seen', rowid: true },
  { table: 'catalog_card_rollout', rowid: false },
  { table: 'catalog_ru_summaries', rowid: true },
];

type Row = Record<string, SQLInputValue>;
const ROWID = '__rowid';
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/u;

interface OldClusterRow {
  rowid: number;
  id: string;
  fingerprint: string;
  title: string;
  company: string;
  cluster_json: string;
  representative: string | null;
  items_count: number;
  updated_at: number;
}

export interface JournalInput {
  readonly stepId: string;
  readonly clusterId: string;
  readonly pieceIds: readonly string[];
  readonly now: number;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function snapshotCatalog(db: DatabaseSync, ids: readonly string[]): Record<string, Row[]> {
  const rows: Record<string, Row[]> = {};
  for (const { table, rowid } of CATALOG_CLUSTER_TABLES) {
    if (!tableExists(db, table)) continue;
    const select = rowid ? `rowid AS ${ROWID}, *` : '*';
    rows[table] = db
      .prepare(`SELECT ${select} FROM ${table} WHERE cluster_id IN (${placeholders(ids.length)})`)
      .all(...ids) as Row[];
  }
  return rows;
}

/** Прежнее состояние кластера и всех id его кусков — одной строкой журнала. */
export function journalClusterSplit(db: DatabaseSync, input: JournalInput): void {
  const ids = [input.clusterId, ...input.pieceIds];
  const old = db
    .prepare('SELECT rowid, * FROM vacancy_clusters WHERE id = ?')
    .get(input.clusterId) as unknown as OldClusterRow;
  const keys = db
    .prepare(
      `SELECT kind, key, cluster_id FROM vacancy_cluster_keys
        WHERE cluster_id IN (${placeholders(ids.length)})`,
    )
    .all(...ids);
  db.prepare(
    `INSERT INTO cluster_split_journal (
       step_id, old_cluster_id, old_rowid, old_fingerprint, old_title, old_company,
       old_cluster_json, old_representative, old_items_count, old_updated_at,
       old_keys_json, old_catalog_json, new_piece_ids_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.stepId,
    input.clusterId,
    old.rowid,
    old.fingerprint,
    old.title,
    old.company,
    old.cluster_json,
    old.representative,
    old.items_count,
    old.updated_at,
    JSON.stringify(keys),
    JSON.stringify(snapshotCatalog(db, ids)),
    JSON.stringify(input.pieceIds),
    input.now,
  );
}

interface JournalRow extends Omit<OldClusterRow, 'id' | 'rowid'> {
  old_cluster_id: string;
  old_rowid: number;
  old_keys_json: string;
  old_catalog_json: string;
  new_piece_ids_json: string;
}

function restoreRows(db: DatabaseSync, table: string, rows: readonly Row[]): void {
  for (const row of rows) {
    const columns = Object.keys(row);
    if (!columns.every((column) => column === ROWID || IDENTIFIER.test(column))) {
      throw new Error(`cluster_split_journal: bad column in ${table}`);
    }
    const names = columns.map((column) => (column === ROWID ? 'rowid' : column));
    db.prepare(
      `INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders(names.length)})`,
    ).run(...columns.map((column) => row[column]!));
  }
}

function restoreCluster(db: DatabaseSync, entry: JournalRow): void {
  const ids = [entry.old_cluster_id, ...(JSON.parse(entry.new_piece_ids_json) as string[])];
  const inIds = `IN (${placeholders(ids.length)})`;
  db.prepare(`DELETE FROM vacancy_clusters WHERE id ${inIds}`).run(...ids);
  db.prepare(
    `INSERT INTO vacancy_clusters (rowid, id, fingerprint, title, company, cluster_json,
       items_count, updated_at, representative) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.old_rowid,
    entry.old_cluster_id,
    entry.old_fingerprint,
    entry.old_title,
    entry.old_company,
    entry.old_cluster_json,
    entry.old_items_count,
    entry.old_updated_at,
    entry.old_representative,
  );
  db.prepare(`DELETE FROM vacancy_cluster_keys WHERE cluster_id ${inIds}`).run(...ids);
  restoreRows(db, 'vacancy_cluster_keys', JSON.parse(entry.old_keys_json) as Row[]);
  const catalog = JSON.parse(entry.old_catalog_json) as Record<string, Row[]>;
  for (const [table, rows] of Object.entries(catalog)) {
    if (!CATALOG_CLUSTER_TABLES.some((known) => known.table === table)) continue;
    db.prepare(`DELETE FROM ${table} WHERE cluster_id ${inIds}`).run(...ids);
    restoreRows(db, table, rows);
  }
}

/**
 * Откат шага разбиения: кластеры, ключи, каталог и переадресации шага
 * возвращаются к журналу одной транзакцией, журнал шага удаляется.
 * Возвращает число восстановленных кластеров.
 */
export function revertClusterSplitStep(db: DatabaseSync, stepId: string): number {
  const entries = db
    .prepare('SELECT * FROM cluster_split_journal WHERE step_id = ? ORDER BY id DESC')
    .all(stepId) as unknown as JournalRow[];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const entry of entries) restoreCluster(db, entry);
    db.prepare('DELETE FROM vacancy_catalog_redirects WHERE step_id = ?').run(stepId);
    db.prepare('DELETE FROM cluster_split_journal WHERE step_id = ?').run(stepId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return entries.length;
}
