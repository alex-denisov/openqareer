import type { DatabaseSync } from 'node:sqlite';
import { CLUSTER_SPLIT_BUDGET_MS, CLUSTER_SPLIT_MAX_PIECES } from './clusterSplitContext';
import {
  CATALOG_CLUSTER_TABLES,
  restoreRows,
  setJournalPieces,
  type JournalRow,
  type Row,
} from './clusterSplitJournal';
import { removePiece } from './clusterSplitWrite';

/**
 * B782: откат шага разбиения частями, каждая — своя короткая транзакция,
 * как запись шага (B752). Основатель возвращается первым и целиком: между
 * частями читатель видит дубль (основатель и ещё не снятые куски), а не дыру.
 * Куски снимаются по бюджету; журнал помнит, какие остались, поэтому откат
 * можно прервать и продолжить.
 */

export interface RevertChunkOptions {
  /** Основатели и куски за одну транзакцию. */
  readonly maxPieces?: number;
  /** Время транзакции, после которого часть не берёт новый кусок. */
  readonly budgetMs?: number;
}

export interface RevertChunkResult {
  /** Кластеры, откат которых закончен в этой части. */
  restored: number;
  founders: number;
  piecesRemoved: number;
  done: boolean;
  writeMs: number;
}

interface Budget {
  readonly maxPieces: number;
  readonly budgetMs: number;
  readonly startedAt: number;
  units: number;
}

function spent(budget: Budget): boolean {
  if (budget.units === 0) return false;
  if (budget.units >= budget.maxPieces) return true;
  return performance.now() - budget.startedAt > budget.budgetMs;
}

/**
 * Основателя переписывать не нужно: он уже возвращён этим откатом (метка),
 * или шаг до него не дошёл (большой кластер, недописанный частями) — тогда
 * его строка та же, что в журнале.
 */
function founderInPlace(db: DatabaseSync, entry: JournalRow): boolean {
  if (db.prepare('SELECT 1 FROM cluster_split_revert_marks WHERE journal_id = ?').get(entry.id)) {
    return true;
  }
  const row = db
    .prepare('SELECT cluster_json FROM vacancy_clusters WHERE id = ?')
    .get(entry.old_cluster_id) as { cluster_json: string } | undefined;
  return row?.cluster_json === entry.old_cluster_json;
}

/**
 * Прежний ключ страницы основателя мог достаться куску (совпадение 32-битного
 * ключа): страница куска уходит раньше самого куска. Ключ у чужого кластера
 * остаётся за ним, как в проекции каталога, — основатель тогда без страницы.
 */
function catalogRowsToRestore(
  db: DatabaseSync,
  table: string,
  rows: readonly Row[],
  pieceIds: ReadonlySet<string>,
): readonly Row[] {
  if (table !== 'catalog_entries') return rows;
  const holder = db.prepare('SELECT cluster_id FROM catalog_entries WHERE entry_key = ?');
  return rows.filter((row) => {
    const held = holder.get(row.entry_key!) as { cluster_id: string } | undefined;
    if (!held || held.cluster_id === row.cluster_id) return true;
    if (!pieceIds.has(held.cluster_id)) return false;
    removePiecePage(db, held.cluster_id);
    return true;
  });
}

function removePiecePage(db: DatabaseSync, pieceId: string): void {
  db.prepare('DELETE FROM catalog_entries WHERE cluster_id = ?').run(pieceId);
}

/**
 * Строка, ключи и каталог основателя — из журнала. Куски в журнале появились
 * позже снимка, поэтому снимок держит только строки основателя. Переадресация
 * его прежнего адреса снимается: страница снова у него.
 */
function restoreFounder(db: DatabaseSync, entry: JournalRow, pieceIds: readonly string[]): void {
  const id = entry.old_cluster_id;
  const pieces = new Set(pieceIds);
  db.prepare('DELETE FROM vacancy_clusters WHERE id = ?').run(id);
  db.prepare(
    `INSERT INTO vacancy_clusters (rowid, id, fingerprint, title, company, cluster_json,
       items_count, updated_at, representative) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.old_rowid,
    id,
    entry.old_fingerprint,
    entry.old_title,
    entry.old_company,
    entry.old_cluster_json,
    entry.old_items_count,
    entry.old_updated_at,
    entry.old_representative,
  );
  db.prepare('DELETE FROM vacancy_cluster_keys WHERE cluster_id = ?').run(id);
  restoreRows(db, 'vacancy_cluster_keys', JSON.parse(entry.old_keys_json) as Row[]);
  const catalog = JSON.parse(entry.old_catalog_json) as Record<string, Row[]>;
  for (const [table, rows] of Object.entries(catalog)) {
    if (!CATALOG_CLUSTER_TABLES.some((known) => known.table === table)) continue;
    db.prepare(`DELETE FROM ${table} WHERE cluster_id = ?`).run(id);
    restoreRows(db, table, catalogRowsToRestore(db, table, rows, pieces));
  }
  const redirect = db.prepare(
    'DELETE FROM vacancy_catalog_redirects WHERE step_id = ? AND old_key = ?',
  );
  const outcome = db.prepare('DELETE FROM cluster_split_pages WHERE step_id = ? AND old_key = ?');
  for (const row of catalog.catalog_entries ?? []) {
    redirect.run(entry.step_id, row.entry_key!);
    outcome.run(entry.step_id, row.entry_key!);
  }
  db.prepare('INSERT INTO cluster_split_revert_marks (journal_id) VALUES (?)').run(entry.id);
}

/** Один кластер, сколько позволяет бюджет. Возвращает, закончен ли его откат. */
function revertEntry(
  db: DatabaseSync,
  entry: JournalRow,
  budget: Budget,
  result: RevertChunkResult,
): boolean {
  const pieces = JSON.parse(entry.new_piece_ids_json) as string[];
  if (!founderInPlace(db, entry)) {
    if (spent(budget)) return false;
    restoreFounder(db, entry, pieces);
    budget.units += 1;
    result.founders += 1;
  }
  let removed = 0;
  while (removed < pieces.length && !spent(budget)) {
    removePiece(db, pieces[removed]!);
    removed += 1;
    budget.units += 1;
  }
  result.piecesRemoved += removed;
  if (removed < pieces.length) {
    if (removed > 0) {
      setJournalPieces(db, entry.step_id, entry.old_cluster_id, pieces.slice(removed));
    }
    return false;
  }
  // Курсор встаёт перед откаченным кластером: исправленный шаг пройдёт его снова.
  db.prepare(
    'UPDATE cluster_split_state SET cursor_rowid = MIN(cursor_rowid, ?), completed = 0 WHERE id = 1',
  ).run(entry.old_rowid - 1);
  db.prepare('DELETE FROM cluster_split_revert_marks WHERE journal_id = ?').run(entry.id);
  db.prepare('DELETE FROM cluster_split_journal WHERE id = ?').run(entry.id);
  result.restored += 1;
  return true;
}

function revertInTransaction(db: DatabaseSync, stepId: string, budget: Budget): RevertChunkResult {
  const result: RevertChunkResult = {
    restored: 0,
    founders: 0,
    piecesRemoved: 0,
    done: false,
    writeMs: 0,
  };
  // Большой кластер, недописанный частями, откатывается целиком: его ход снимается.
  db.prepare('DELETE FROM cluster_split_progress WHERE journal_step_id = ?').run(stepId);
  const entries = db
    .prepare('SELECT * FROM cluster_split_journal WHERE step_id = ? ORDER BY id DESC')
    .all(stepId) as unknown as JournalRow[];
  for (const entry of entries) {
    if (!revertEntry(db, entry, budget, result)) return result;
  }
  db.prepare('DELETE FROM vacancy_catalog_redirects WHERE step_id = ?').run(stepId);
  db.prepare('DELETE FROM cluster_split_pages WHERE step_id = ?').run(stepId);
  return { ...result, done: true };
}

/** Одна часть отката шага: одна транзакция в пределах бюджета. */
export function revertClusterSplitChunk(
  db: DatabaseSync,
  stepId: string,
  options: RevertChunkOptions = {},
): RevertChunkResult {
  const startedAt = performance.now();
  const budget: Budget = {
    maxPieces: Math.max(1, Math.trunc(options.maxPieces ?? CLUSTER_SPLIT_MAX_PIECES)),
    budgetMs: Math.max(0, options.budgetMs ?? CLUSTER_SPLIT_BUDGET_MS),
    startedAt,
    units: 0,
  };
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = revertInTransaction(db, stepId, budget);
    db.exec('COMMIT');
    return { ...result, writeMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Откат шага целиком — подряд частями, между частями запись открыта другим.
 * Возвращает число восстановленных кластеров.
 */
export function revertClusterSplitStep(
  db: DatabaseSync,
  stepId: string,
  options: RevertChunkOptions = {},
): number {
  let restored = 0;
  for (;;) {
    const chunk = revertClusterSplitChunk(db, stepId, options);
    restored += chunk.restored;
    if (chunk.done) return restored;
  }
}
