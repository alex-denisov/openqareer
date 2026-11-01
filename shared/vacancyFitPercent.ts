/**
 * The one percent the vacancy row, the expanded vacancy and the order show (mockup
 * 4-vakansii-procent, 29.10). The server computes it in `server/domain/vacancyFit.ts`:
 * round((met + 0.5 × partially met) / all skill requirements × 100); stated or checked alike (01.11).
 */
import type { VacancyFitView } from './vacancyFit';

/** Fewer skill requirements give no percent (B510-r): never «100 %» from 1 of 1. */
export const MIN_FIT_SKILL_REQUIREMENTS = 3;
/** A requirement the profile covers only in part (01.11). A met one counts 1, checked or not. */
export const PARTIAL_REQUIREMENT_CREDIT = 0.5;

export type VacancyFitTier = 'hi' | 'good' | 'mid' | 'low';

export function vacancyFitPercent(view: VacancyFitView | undefined): number | null {
  const result = view?.result;
  if (view?.state !== 'ready' && view?.state !== 'refreshing') return null;
  if (!result || result.status !== 'assessed' || result.dataState === 'unknown') return null;
  const percent = result.coveragePercent;
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100)
    return null;
  return (result.coverage?.total ?? 0) >= MIN_FIT_SKILL_REQUIREMENTS ? percent : null;
}

/** 80–100 strong, 60–79 good, 40–59 partial, below 40 weak. Never red: weak is not an error. */
export function vacancyFitTier(percent: number): VacancyFitTier {
  if (percent >= 80) return 'hi';
  if (percent >= 60) return 'good';
  if (percent >= 40) return 'mid';
  return 'low';
}

/**
 * States whose percent is still coming: the row says «считаем» (28.10 mockup). A failed count is
 * one of them (29.10): the shown page re-queues it, and the mockup has no «failed» state.
 */
export const FIT_COUNTING_STATES: readonly VacancyFitView['state'][] = [
  'not_requested',
  'processing',
  'retrying',
  'refreshing',
  'failed',
];
/** Below this a counted row does not push rows still counting down (CPO, 28.10 evening). */
export const FIT_LOW_PERCENT = 40;

export type VacancyFitStage = 'counted' | 'counting' | 'counted_low' | 'none';

/** The one stage the row, the expanded block and the order read. */
export function vacancyFitStage(view: VacancyFitView | undefined): VacancyFitStage {
  const percent = vacancyFitPercent(view);
  if (percent !== null) return percent >= FIT_LOW_PERCENT ? 'counted' : 'counted_low';
  if (!view || FIT_COUNTING_STATES.includes(view.state)) return 'counting';
  return 'none';
}

// 02.11 (.app run 3): a row still counting sat between 40 % and 31 %; every percent goes first now.
const STAGE_RANK: Readonly<Record<VacancyFitStage, number>> = {
  counted: 0,
  counted_low: 0,
  counting: 1,
  none: 2,
};

/**
 * Every counted row by percent, then rows still counting (the caller keeps relevance among them),
 * then rows that cannot be counted. Rows blocked by a condition go after all of them (vacancySort).
 */
export function compareFitPercent(
  left: VacancyFitView | undefined,
  right: VacancyFitView | undefined,
): number {
  const stage = STAGE_RANK[vacancyFitStage(left)] - STAGE_RANK[vacancyFitStage(right)];
  if (stage !== 0) return stage;
  return (vacancyFitPercent(right) ?? 0) - (vacancyFitPercent(left) ?? 0);
}
