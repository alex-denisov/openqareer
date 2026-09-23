import { inferSeniorityLevel } from './levelMatcher';
import type { ApplicationProcessProfile } from '../../shared/followUpPolicy';

/**
 * B251, S2 — owner decision, 2026-09-23 22:26 (pending final confirmation):
 * a card defaults to `executive` when the vacancy title reads VP/C-level,
 * with a manual override always available afterwards (`PATCH .../processProfile`).
 * Kept as one switch so the owner can flip it without touching call sites.
 */
export const AUTO_DETECT_EXECUTIVE_PROFILE = true;

/**
 * `undefined` `vacancyTitle` (manual card without a title yet) falls back to
 * `standard`: there is nothing to infer from.
 */
export function defaultProcessProfile(
  vacancyTitle: string | undefined,
): ApplicationProcessProfile {
  if (!AUTO_DETECT_EXECUTIVE_PROFILE || !vacancyTitle) return 'standard';
  const level = inferSeniorityLevel(vacancyTitle);
  return level === 'vp' || level === 'c-level' ? 'executive' : 'standard';
}
