import type { DatabaseSync } from 'node:sqlite';
import type { PageOutcome } from './clusterSplitPages';
import type { SplitWriters } from './clusterSplitWrite';

/** B752: общее у шага разбиения — результат, бюджет записи, счётчики состояния. */

/** 23.11, копия прода: 5–10 мс на кусок с ключами и каталогом, холодный кэш. */
export const CLUSTER_SPLIT_MAX_PIECES = 40;
export const CLUSTER_SPLIT_BUDGET_MS = 500;

export type ClusterSplitLog = (event: string, fields: Record<string, unknown>) => void;

export interface ClusterSplitStepResult {
  stepId: string | null;
  scanned: number;
  split: number;
  pieces: number;
  skippedCandidateRef: number;
  skippedIdTaken: number;
  catalogMoved: number;
  /** Прежние страницы шага по итогу; `unresolved` должно быть 0. */
  pages: Record<PageOutcome, number>;
  /** Куски, записанные шагом (кроме основателя). */
  newPieceIds: string[];
  completed: boolean;
  /** Сколько шаг держал транзакцию записи (BEGIN IMMEDIATE … COMMIT), мс. */
  writeMs: number;
  /** Шаг просит остановить разбиение. */
  stop?: boolean;
}

export interface StepContext {
  readonly db: DatabaseSync;
  readonly stepId: string;
  readonly now: number;
  readonly log: ClusterSplitLog;
  readonly writers: SplitWriters;
  readonly maxPieces: number;
  readonly budgetMs: number;
  readonly startedAt: number;
  readonly result: ClusterSplitStepResult;
  /** Строк кластеров, записанных шагом: куски и основатели. */
  units: number;
}

export function emptyResult(stepId: string | null, completed: boolean): ClusterSplitStepResult {
  return {
    stepId,
    scanned: 0,
    split: 0,
    pieces: 0,
    skippedCandidateRef: 0,
    skippedIdTaken: 0,
    catalogMoved: 0,
    pages: { kept: 0, redirect: 0, gone: 0, unresolved: 0 },
    newPieceIds: [],
    completed,
    writeMs: 0,
  };
}

/** Бюджет исчерпан: по числу записанных кластеров или по времени транзакции. */
export function budgetSpent(context: StepContext, adding = 1): boolean {
  if (context.units === 0) return false;
  if (context.units + adding > context.maxPieces) return true;
  return performance.now() - context.startedAt > context.budgetMs;
}

export function pieceIdTaken(db: DatabaseSync, pieceIds: readonly string[]): boolean {
  const exists = db.prepare('SELECT 1 FROM vacancy_clusters WHERE id = ?');
  return pieceIds.some((id) => exists.get(id) !== undefined);
}

export function saveState(context: StepContext, cursor: number): void {
  const { result } = context;
  context.db
    .prepare(
      `UPDATE cluster_split_state SET cursor_rowid = ?, completed = ?, steps = steps + 1,
         clusters_split = clusters_split + ?, pieces_created = pieces_created + ?,
         skipped_candidate_ref = skipped_candidate_ref + ?, catalog_moved = catalog_moved + ?,
         updated_at = ? WHERE id = 1`,
    )
    .run(
      cursor,
      result.completed ? 1 : 0,
      result.split,
      result.pieces,
      result.skippedCandidateRef,
      result.catalogMoved,
      context.now,
    );
}
