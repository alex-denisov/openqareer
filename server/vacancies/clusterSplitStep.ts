import type { DatabaseSync } from 'node:sqlite';
import { vacancyKey } from '../../shared/vacancyCatalogRoutes';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import {
  candidateReferencedClusters,
  hasCrossSourceIdCollision,
  loadMemberVacancies,
  parseCluster,
  planClusterSplit,
  tableExists,
} from './clusterSplit';
import { CATALOG_CLUSTER_TABLES, journalClusterSplit } from './clusterSplitJournal';
import { clusterKeys, serializeRepresentative } from './vacancyDeduplicator';

export { revertClusterSplitStep } from './clusterSplitJournal';

/**
 * B752: шаг разбиения склеенных кластеров. Одна короткая транзакция на
 * `chunk` кластеров после курсора; каждый разбитый кластер сперва ложится
 * в журнал, затем пишутся куски, ключи и переезд страницы каталога.
 */

export type ClusterSplitLog = (event: string, fields: Record<string, unknown>) => void;

export interface ClusterSplitStepOptions {
  readonly chunk?: number;
  readonly now?: number;
  readonly log?: ClusterSplitLog;
}

export interface ClusterSplitStepResult {
  stepId: string | null;
  scanned: number;
  split: number;
  pieces: number;
  skippedCandidateRef: number;
  skippedIdTaken: number;
  catalogMoved: number;
  /** Кластеры шага с кусками: id всех кусков, кроме основателя. */
  newPieceIds: string[];
  completed: boolean;
}

export const CLUSTER_SPLIT_CHUNK = 200;
const MAX_CHUNK = 1_000;

interface StepContext {
  readonly db: DatabaseSync;
  readonly stepId: string;
  readonly now: number;
  readonly referenced: ReadonlyMap<string, string>;
  readonly log: ClusterSplitLog;
  readonly result: ClusterSplitStepResult;
}

function emptyResult(stepId: string | null, completed: boolean): ClusterSplitStepResult {
  return {
    stepId,
    scanned: 0,
    split: 0,
    pieces: 0,
    skippedCandidateRef: 0,
    skippedIdTaken: 0,
    catalogMoved: 0,
    newPieceIds: [],
    completed,
  };
}

function writePieces(context: StepContext, cluster: VacancyCluster, pieces: VacancyCluster[]) {
  const { db, now } = context;
  const upsert = db.prepare(
    `INSERT INTO vacancy_clusters (
       id, fingerprint, title, company, cluster_json, items_count, updated_at, representative
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET fingerprint = excluded.fingerprint, title = excluded.title,
       company = excluded.company, cluster_json = excluded.cluster_json,
       items_count = excluded.items_count, updated_at = excluded.updated_at,
       representative = excluded.representative`,
  );
  const insertKey = db.prepare(
    'INSERT OR IGNORE INTO vacancy_cluster_keys (kind, key, cluster_id) VALUES (?, ?, ?)',
  );
  db.prepare('DELETE FROM vacancy_cluster_keys WHERE cluster_id = ?').run(cluster.id);
  for (const piece of pieces) {
    upsert.run(
      piece.id,
      piece.id,
      piece.canonicalTitle,
      piece.canonicalCompany,
      JSON.stringify(piece),
      piece.vacanciesCount,
      now,
      serializeRepresentative(piece),
    );
    for (const { kind, key } of clusterKeys(piece)) insertKey.run(kind, key, piece.id);
  }
}

interface CatalogEntryRow {
  entry_key: string;
  path: string;
  source_url: string;
}

/** Страница каталога уходит к куску, чья площадка дала её ссылку; старый ключ — в переадресацию. */
function moveCatalogPage(context: StepContext, oldId: string, pieces: VacancyCluster[]): void {
  const { db } = context;
  const entry = db
    .prepare('SELECT entry_key, path, source_url FROM catalog_entries WHERE cluster_id = ?')
    .get(oldId) as CatalogEntryRow | undefined;
  if (!entry) return;
  const holder = pieces.findIndex((piece) =>
    piece.sources.some((source) => source.sourceUrl === entry.source_url),
  );
  if (holder <= 0) return;
  const newId = pieces[holder]!.id;
  const newKey = vacancyKey(newId);
  const suffix = `-${entry.entry_key}`;
  const keyTaken = db.prepare('SELECT 1 FROM catalog_entries WHERE entry_key = ?').get(newKey);
  if (keyTaken || !entry.path.endsWith(suffix)) return;
  const newPath = `${entry.path.slice(0, -suffix.length)}-${newKey}`;
  db.prepare(
    'UPDATE catalog_entries SET cluster_id = ?, entry_key = ?, path = ? WHERE cluster_id = ?',
  ).run(newId, newKey, newPath, oldId);
  for (const { table } of CATALOG_CLUSTER_TABLES.slice(1)) {
    if (!tableExists(db, table)) continue;
    db.prepare(`UPDATE OR REPLACE ${table} SET cluster_id = ? WHERE cluster_id = ?`).run(
      newId,
      oldId,
    );
  }
  db.prepare(
    `INSERT OR REPLACE INTO vacancy_catalog_redirects
       (old_key, old_path, new_cluster_id, new_key, step_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(entry.entry_key, entry.path, newId, newKey, context.stepId, context.now);
  context.result.catalogMoved += 1;
}

function pieceIdTaken(db: DatabaseSync, pieceIds: readonly string[]): boolean {
  const exists = db.prepare('SELECT 1 FROM vacancy_clusters WHERE id = ?');
  return pieceIds.some((id) => exists.get(id) !== undefined);
}

function splitOne(context: StepContext, cluster: VacancyCluster): void {
  const { db, result } = context;
  if (!hasCrossSourceIdCollision(cluster)) return;
  const pieces = planClusterSplit(cluster, loadMemberVacancies(db, cluster));
  if (pieces.length <= 1) return;
  const table = context.referenced.get(cluster.id);
  if (table) {
    result.skippedCandidateRef += 1;
    context.log('cluster_split_skipped_candidate_ref', { clusterId: cluster.id, table });
    return;
  }
  const pieceIds = pieces.slice(1).map((piece) => piece.id);
  if (pieceIdTaken(db, pieceIds)) {
    result.skippedIdTaken += 1;
    return;
  }
  journalClusterSplit(db, {
    stepId: context.stepId,
    clusterId: cluster.id,
    pieceIds,
    now: context.now,
  });
  writePieces(context, cluster, pieces);
  moveCatalogPage(context, cluster.id, pieces);
  result.split += 1;
  result.pieces += pieceIds.length;
  result.newPieceIds.push(...pieceIds);
}

function saveState(db: DatabaseSync, cursor: number, result: ClusterSplitStepResult, now: number) {
  db.prepare(
    `UPDATE cluster_split_state SET cursor_rowid = ?, completed = ?, steps = steps + 1,
       clusters_split = clusters_split + ?, pieces_created = pieces_created + ?,
       skipped_candidate_ref = skipped_candidate_ref + ?, catalog_moved = catalog_moved + ?,
       updated_at = ? WHERE id = 1`,
  ).run(
    cursor,
    result.completed ? 1 : 0,
    result.split,
    result.pieces,
    result.skippedCandidateRef,
    result.catalogMoved,
    now,
  );
}

function inTransaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = operation();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Один шаг разбиения. Резюмируем: курсор — `vacancy_clusters.rowid`. */
export function splitClustersStep(
  db: DatabaseSync,
  options: ClusterSplitStepOptions = {},
): ClusterSplitStepResult {
  const state = db
    .prepare('SELECT cursor_rowid, completed FROM cluster_split_state WHERE id = 1')
    .get() as { cursor_rowid: number; completed: number };
  if (state.completed === 1) return emptyResult(null, true);
  const now = options.now ?? Date.now();
  const chunk = Math.max(1, Math.min(Math.trunc(options.chunk ?? CLUSTER_SPLIT_CHUNK), MAX_CHUNK));
  const context: StepContext = {
    db,
    now,
    stepId: `split-${state.cursor_rowid}-${now}`,
    referenced: candidateReferencedClusters(db),
    log: options.log ?? (() => undefined),
    result: emptyResult(`split-${state.cursor_rowid}-${now}`, false),
  };
  return inTransaction(db, () => {
    const rows = db
      .prepare(
        'SELECT rowid, cluster_json FROM vacancy_clusters WHERE rowid > ? ORDER BY rowid LIMIT ?',
      )
      .all(state.cursor_rowid, chunk) as { rowid: number; cluster_json: string }[];
    context.result.completed = rows.length === 0;
    for (const row of rows) {
      context.result.scanned += 1;
      const cluster = parseCluster(row.cluster_json);
      if (cluster) splitOne(context, cluster);
    }
    saveState(db, rows.at(-1)?.rowid ?? state.cursor_rowid, context.result, now);
    return context.result;
  });
}
