import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { droppedSources } from './clusterSplit';
import { budgetSpent, pieceIdTaken, type StepContext } from './clusterSplitContext';
import { journalClusterSplit, setJournalPieces } from './clusterSplitJournal';
import type { PlannedSplit } from './clusterSplitPlan';
import { removePiece, writeFounder, writePiece } from './clusterSplitWrite';

/**
 * B752: большой кластер (кусков больше бюджета шага) пишется частями. Журнал —
 * в первой части; куски — шаг за шагом; основатель — последним, поэтому до
 * конца он держит все прежние площадки и ключи: читатель видит дубль, не дыру.
 */

/** Сколько отброшенных источников называет строка журнала событий. */
const DROPPED_SAMPLE = 5;

export interface SplitProgress {
  readonly cluster_id: string;
  readonly cluster_rowid: number;
  readonly journal_step_id: string;
  readonly next_index: number;
  /** Строка основателя, по плану которой записаны куски до `next_index`. */
  readonly cluster_json_sha1: string;
}

const sha1 = (text: string): string => createHash('sha1').update(text).digest('hex');

export function readProgress(db: DatabaseSync): SplitProgress | undefined {
  return db
    .prepare(
      'SELECT cluster_id, cluster_rowid, journal_step_id, next_index, cluster_json_sha1 FROM cluster_split_progress WHERE id = 1',
    )
    .get() as SplitProgress | undefined;
}

function saveProgress(context: StepContext, progress: SplitProgress): void {
  context.db
    .prepare(
      `INSERT OR REPLACE INTO cluster_split_progress
         (id, cluster_id, cluster_rowid, journal_step_id, next_index, cluster_json_sha1, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      progress.cluster_id,
      progress.cluster_rowid,
      progress.journal_step_id,
      progress.next_index,
      progress.cluster_json_sha1,
      context.now,
    );
}

export function clearProgress(db: DatabaseSync): void {
  db.prepare('DELETE FROM cluster_split_progress WHERE id = 1').run();
}

/** Основатель переписан: кластер разбит. */
function finishSplit(context: StepContext, plan: PlannedSplit, redirectStepId: string): void {
  const outcome = writeFounder(context.writers, plan, redirectStepId);
  if (outcome) {
    context.result.catalogMoved += 1;
    context.result.pages[outcome] += 1;
    if (outcome === 'unresolved') {
      context.log('cluster_split_page_unresolved', { clusterId: plan.cluster.id });
    }
  }
  const dropped = droppedSources(plan.cluster, plan.pieces);
  if (dropped.length > 0) {
    context.log('cluster_split_sources_dropped', {
      clusterId: plan.cluster.id,
      count: dropped.length,
      sample: dropped.slice(0, DROPPED_SAMPLE).map((s) => `${s.sourceId}:${s.externalId}`),
    });
  }
  context.units += 1;
  context.result.split += 1;
}

/** Куски с `from`, пока есть бюджет; основатель — когда куски кончились. `null` — кластер дописан. */
function writeParts(
  context: StepContext,
  plan: PlannedSplit,
  from: number,
  journalStepId: string,
): number | null {
  let index = from;
  while (index < plan.pieces.length) {
    if (budgetSpent(context)) return index;
    const piece = plan.pieces[index]!;
    writePiece(context.writers, piece);
    context.units += 1;
    context.result.pieces += 1;
    context.result.newPieceIds.push(piece.id);
    index += 1;
  }
  if (budgetSpent(context)) return index;
  finishSplit(context, plan, journalStepId);
  return null;
}

/** Кластер целиком или его первая часть: журнал и первые куски. `partial` — продолжение в следующих шагах. */
export function startSplit(context: StepContext, plan: PlannedSplit): 'done' | 'partial' {
  const pieceIds = plan.pieces.slice(1).map((piece) => piece.id);
  if (pieceIdTaken(context.db, pieceIds)) {
    context.result.skippedIdTaken += 1;
    return 'done';
  }
  journalClusterSplit(context.db, {
    stepId: context.stepId,
    clusterId: plan.cluster.id,
    pieceIds,
    now: context.now,
  });
  const next = writeParts(context, plan, 1, context.stepId);
  if (next === null) return 'done';
  saveProgress(context, {
    cluster_id: plan.cluster.id,
    cluster_rowid: plan.rowid,
    journal_step_id: context.stepId,
    next_index: next,
    cluster_json_sha1: sha1(plan.json),
  });
  return 'partial';
}

interface JournalEntry {
  readonly new_piece_ids_json: string;
}

function journalPieces(context: StepContext, progress: SplitProgress): string[] {
  const entry = context.db
    .prepare(
      'SELECT new_piece_ids_json FROM cluster_split_journal WHERE step_id = ? AND old_cluster_id = ?',
    )
    .get(progress.journal_step_id, progress.cluster_id) as JournalEntry | undefined;
  return entry ? (JSON.parse(entry.new_piece_ids_json) as string[]) : [];
}

/**
 * Разбиение бросается: записанные куски снимаются (до первой части их id были
 * свободны), основатель не тронут — он переписывается только последним.
 */
function abandon(context: StepContext, progress: SplitProgress, written: readonly string[]): void {
  for (const id of written) removePiece(context.db, id);
  context.db
    .prepare('DELETE FROM cluster_split_journal WHERE step_id = ? AND old_cluster_id = ?')
    .run(progress.journal_step_id, progress.cluster_id);
  clearProgress(context.db);
}

/** Почему разбиение больше нельзя продолжать: кластер кандидата или занятый id нового куска. */
function blocker(
  context: StepContext,
  referencedBy: string | undefined,
  added: readonly string[],
): 'ref' | 'taken' | undefined {
  if (referencedBy) return 'ref';
  return pieceIdTaken(context.db, added) ? 'taken' : undefined;
}

/**
 * План мог смениться между частями: обход дописал основателю площадку, или
 * процесс перезапустился. Куски не из нового плана снимаются, журнал получает
 * ровно новый список, и запись идёт с первого куска (повтор безвреден).
 */
function reconcile(
  context: StepContext,
  progress: SplitProgress,
  plan: PlannedSplit,
  known: readonly string[],
): number {
  const target = plan.pieces.slice(1).map((piece) => piece.id);
  for (const id of known) if (!target.includes(id)) removePiece(context.db, id);
  setJournalPieces(context.db, progress.journal_step_id, progress.cluster_id, target);
  // Тот же основатель и те же куски: продолжаем с места; иначе — с первого куска.
  const unchanged =
    sha1(plan.json) === progress.cluster_json_sha1 && target.every((id) => known.includes(id));
  return unchanged ? progress.next_index : 1;
}

/**
 * Следующая часть большого кластера. Возвращает, пройден ли он (дописан,
 * брошен или больше не требует разбиения). `referencedBy` — таблица кандидата,
 * если кластер успел попасть к кандидату.
 */
export function continueLargeSplit(
  context: StepContext,
  progress: SplitProgress,
  plan: PlannedSplit | undefined,
  referencedBy: string | undefined,
): boolean {
  const known = journalPieces(context, progress);
  const added = plan
    ? plan.pieces
        .slice(1)
        .map((piece) => piece.id)
        .filter((id) => !known.includes(id))
    : [];
  const reason = plan ? blocker(context, referencedBy, added) : undefined;
  if (plan === undefined || reason) {
    abandon(context, progress, known);
    if (reason === 'ref') {
      context.result.skippedCandidateRef += 1;
      context.log('cluster_split_skipped_candidate_ref', {
        clusterId: progress.cluster_id,
        table: referencedBy,
      });
    }
    if (reason === 'taken') context.result.skippedIdTaken += 1;
    return true;
  }
  const next = writeParts(
    context,
    plan,
    reconcile(context, progress, plan, known),
    progress.journal_step_id,
  );
  if (next === null) {
    clearProgress(context.db);
    return true;
  }
  saveProgress(context, { ...progress, next_index: next, cluster_json_sha1: sha1(plan.json) });
  return false;
}
