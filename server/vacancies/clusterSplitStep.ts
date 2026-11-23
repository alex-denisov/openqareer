import type { DatabaseSync } from 'node:sqlite';
import { candidateReferencedClusters } from './clusterSplit';
import {
  budgetSpent,
  emptyResult,
  pieceIdTaken,
  saveState,
  type ClusterSplitLog,
  type ClusterSplitStepResult,
  type StepContext,
} from './clusterSplitContext';
import { journalClusterSplit } from './clusterSplitJournal';
import {
  clearProgress,
  continueLargeSplit,
  finishSplit,
  readProgress,
  startLargeSplit,
  type SplitProgress,
} from './clusterSplitLarge';
import {
  planChunk,
  planOf,
  rememberPlan,
  type PlannedItem,
  type PlannedSplit,
} from './clusterSplitPlan';
import { prepareSplitWriters, writePiece } from './clusterSplitWrite';

export { revertClusterSplitStep } from './clusterSplitJournal';
export type { ClusterSplitLog, ClusterSplitStepResult } from './clusterSplitContext';

/**
 * B752: шаг разбиения склеенных кластеров. План (чтение пула и сведение
 * кусков) строится до транзакции; транзакция записи держит не больше
 * `maxPieces` строк кластеров и `budgetMs` времени. Кластер, чьих кусков
 * больше бюджета, пишется частями в следующих шагах (`clusterSplitLarge`).
 */

export interface ClusterSplitStepOptions {
  readonly chunk?: number;
  readonly now?: number;
  readonly log?: ClusterSplitLog;
  /** Строк кластеров (кусков и основателей) на одну транзакцию записи. */
  readonly maxPieces?: number;
  /** Время транзакции записи, после которого шаг не начинает новый кусок. */
  readonly budgetMs?: number;
}

export const CLUSTER_SPLIT_CHUNK = 200;
const MAX_CHUNK = 1_000;
/** 23.11, копия прода: 5–10 мс на кусок с ключами и каталогом, холодный кэш. */
export const CLUSTER_SPLIT_MAX_PIECES = 40;
export const CLUSTER_SPLIT_BUDGET_MS = 500;

interface State {
  readonly cursor_rowid: number;
  readonly completed: number;
}

/** Транзакция записи; её длительность ложится в `writeMs` результата. */
function inTransaction(
  db: DatabaseSync,
  operation: () => ClusterSplitStepResult,
): ClusterSplitStepResult {
  const at = performance.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return { ...result, writeMs: Math.round(performance.now() - at) };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function clusterJson(db: DatabaseSync, id: string): string | undefined {
  const row = db.prepare('SELECT cluster_json FROM vacancy_clusters WHERE id = ?').get(id) as
    { cluster_json: string } | undefined;
  return row?.cluster_json;
}

/** Кластер целиком в одной транзакции: журнал, куски, основатель. */
function splitWhole(context: StepContext, plan: PlannedSplit): void {
  const pieceIds = plan.pieces.slice(1).map((piece) => piece.id);
  if (pieceIdTaken(context.db, pieceIds)) {
    context.result.skippedIdTaken += 1;
    return;
  }
  journalClusterSplit(context.db, {
    stepId: context.stepId,
    clusterId: plan.cluster.id,
    pieceIds,
    now: context.now,
  });
  for (const piece of plan.pieces.slice(1)) {
    writePiece(context.writers, piece);
    context.units += 1;
  }
  context.result.pieces += pieceIds.length;
  context.result.newPieceIds.push(...pieceIds);
  finishSplit(context, plan, context.stepId);
}

function applyItem(context: StepContext, item: PlannedItem): 'done' | 'partial' {
  if (item.kind === 'pass') return 'done';
  if (item.kind === 'ref') {
    context.result.skippedCandidateRef += 1;
    context.log('cluster_split_skipped_candidate_ref', {
      clusterId: item.clusterId,
      table: item.table,
    });
    return 'done';
  }
  if (item.pieces.length > context.maxPieces) return startLargeSplit(context, item);
  splitWhole(context, item);
  return 'done';
}

/** Пункты плана по порядку, пока есть бюджет; курсор встаёт на последний пройденный. */
function writeItems(context: StepContext, items: readonly PlannedItem[], cursor: number): void {
  context.result.completed = items.length === 0;
  let at = cursor;
  for (const item of items) {
    if (item.kind === 'split') {
      if (budgetSpent(context, Math.min(item.pieces.length, context.maxPieces))) break;
      // Строка сменилась после плана: следующий шаг построит план заново.
      if (clusterJson(context.db, item.cluster.id) !== item.json) break;
    }
    if (applyItem(context, item) === 'partial') break;
    context.result.scanned += 1;
    at = item.rowid;
  }
  saveState(context, at);
}

function contextFor(
  db: DatabaseSync,
  cursor: number,
  options: ClusterSplitStepOptions,
  journalStepId?: string,
): StepContext {
  const now = options.now ?? Date.now();
  // Часть большого кластера — под id шага, открывшего журнал: откат по нему снимает весь кластер.
  const stepId = journalStepId ?? `split-${cursor}-${now}`;
  return {
    db,
    stepId,
    now,
    log: options.log ?? (() => undefined),
    writers: prepareSplitWriters(db, now),
    maxPieces: Math.max(1, Math.trunc(options.maxPieces ?? CLUSTER_SPLIT_MAX_PIECES)),
    budgetMs: Math.max(0, options.budgetMs ?? CLUSTER_SPLIT_BUDGET_MS),
    startedAt: 0,
    result: emptyResult(stepId, false),
    units: 0,
  };
}

/** Начать отсчёт бюджета, когда транзакция записи уже открыта. */
const started = (context: StepContext): StepContext => ({
  ...context,
  startedAt: performance.now(),
});

function continueStep(
  db: DatabaseSync,
  state: State,
  progress: SplitProgress,
  options: ClusterSplitStepOptions,
): ClusterSplitStepResult {
  const row = db
    .prepare('SELECT rowid, cluster_json FROM vacancy_clusters WHERE id = ?')
    .get(progress.cluster_id) as { rowid: number; cluster_json: string } | undefined;
  const plan = row ? planOf(db, row.rowid, row.cluster_json) : undefined;
  if (plan) rememberPlan(plan);
  const referenced = candidateReferencedClusters(db);
  return inTransaction(db, () => {
    const context = started(contextFor(db, state.cursor_rowid, options, progress.journal_step_id));
    if (row && clusterJson(db, progress.cluster_id) !== row.cluster_json) return context.result;
    // Основателя кто-то удалил: записанные куски остаются, ход снимается.
    if (!row) clearProgress(db);
    const finished = row
      ? continueLargeSplit(context, progress, plan, referenced.get(progress.cluster_id))
      : true;
    if (finished) context.result.scanned += 1;
    saveState(context, finished ? progress.cluster_rowid : state.cursor_rowid);
    return context.result;
  });
}

/** Один шаг разбиения. Резюмируем: курсор — `vacancy_clusters.rowid`. */
export function splitClustersStep(
  db: DatabaseSync,
  options: ClusterSplitStepOptions = {},
): ClusterSplitStepResult {
  const state = db
    .prepare('SELECT cursor_rowid, completed FROM cluster_split_state WHERE id = 1')
    .get() as unknown as State;
  if (state.completed === 1) return emptyResult(null, true);
  const progress = readProgress(db);
  if (progress) return continueStep(db, state, progress, options);
  const base = contextFor(db, state.cursor_rowid, options);
  const items = planChunk(db, {
    cursor: state.cursor_rowid,
    chunk: Math.max(1, Math.min(Math.trunc(options.chunk ?? CLUSTER_SPLIT_CHUNK), MAX_CHUNK)),
    maxPieces: base.maxPieces,
    referenced: candidateReferencedClusters(db),
  });
  return inTransaction(db, () => {
    const context = started(base);
    writeItems(context, items, state.cursor_rowid);
    return context.result;
  });
}
