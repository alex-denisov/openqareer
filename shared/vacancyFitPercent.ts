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

/** Descending by percent; rows still computing or without a percent go after all counted rows. */
export function compareFitPercent(
  left: VacancyFitView | undefined,
  right: VacancyFitView | undefined,
): number {
  const a = vacancyFitPercent(left);
  const b = vacancyFitPercent(right);
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}
