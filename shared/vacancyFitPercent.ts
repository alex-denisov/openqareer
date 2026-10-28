/**
 * The one percent the vacancy row, the expanded vacancy and the order show (mockup
 * 4-vakansii-procent, 28.10). The server computes it in `server/domain/vacancyFit.ts`:
 * round(skill requirements with profile evidence / all skill requirements × 100), capped at
 * 100 − 10 per unconfirmed role, region or work permit.
 */
import type { VacancyFitResult, VacancyFitView } from './vacancyFit';

/** Fewer skill requirements give no percent (B510-r): never «100 %» from 1 of 1. */
export const MIN_FIT_SKILL_REQUIREMENTS = 3;
/** Key conditions that lower the ceiling when unconfirmed; must match the server's KEY_GATES. */
export const FIT_KEY_GATES = ['role', 'region', 'workAuthorization'] as const;
export const FIT_UNCONFIRMED_GATE_PENALTY = 10;

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

export function vacancyFitCeiling(result: Pick<VacancyFitResult, 'gates'>): number {
  const unconfirmed = FIT_KEY_GATES.filter((name) => result.gates?.[name]?.status !== 'matched');
  return 100 - FIT_UNCONFIRMED_GATE_PENALTY * unconfirmed.length;
}

/** States whose percent is still coming: the row says «считаем» (28.10 mockup). */
export const FIT_COUNTING_STATES: readonly VacancyFitView['state'][] = [
  'not_requested',
  'processing',
  'retrying',
  'refreshing',
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

const STAGE_RANK: Readonly<Record<VacancyFitStage, number>> = {
  counted: 0,
  counting: 1,
  counted_low: 2,
  none: 3,
};

/**
 * 40 %+ by percent, then rows still counting (the caller keeps relevance among them), then
 * counted rows below 40 % by percent, then rows that cannot be counted.
 */
export function compareFitPercent(
  left: VacancyFitView | undefined,
  right: VacancyFitView | undefined,
): number {
  const stage = STAGE_RANK[vacancyFitStage(left)] - STAGE_RANK[vacancyFitStage(right)];
  if (stage !== 0) return stage;
  return (vacancyFitPercent(right) ?? 0) - (vacancyFitPercent(left) ?? 0);
}
