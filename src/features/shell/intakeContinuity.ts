/**
 * B141 — who owns the «Сегодня» screen while a diagnostic is unfinished.
 *
 * The wizard's own second step demands an account (LinkedIn/hh.ru import writes
 * into a candidate-scoped store), so a candidate registers *inside* the wizard.
 * Before this module the arriving session both switched the screen to the
 * cabinet and changed the wizard's React key, which unmounted it and threw the
 * answers away. Both decisions are pure, so they live here and are asserted
 * without a browser.
 */

export interface IntakeVisibilityInput {
  /** Identity is still being checked; nothing candidate-shaped may render. */
  sessionPending: boolean;
  /** A career picture already exists, so the diagnostic is finished. */
  hasWorkspace: boolean;
  /** A signed-in candidate whose cabinet is available. */
  hasCabinetSession: boolean;
  /** The candidate pressed «Начать диагностику» and has not finished. */
  intakeStarted: boolean;
  /** The wizard only ever owns the «Сегодня» screen. */
  isTodayView: boolean;
}

/**
 * A started diagnostic keeps the screen even after an account appears; a
 * signed-in candidate who never started one still opens the cabinet, which is
 * the contract the cabinet was built on.
 */
export function shouldShowIntake(input: IntakeVisibilityInput): boolean {
  if (input.sessionPending) return false;
  if (input.hasWorkspace) return false;
  if (!input.isTodayView) return false;
  return !input.hasCabinetSession || input.intakeStarted;
}

/**
 * Typed answers must never travel from one candidate into another candidate's
 * session, so any identity change resets the wizard — except the one change the
 * wizard itself asked for: anonymous becoming a signed-in candidate.
 */
export function keepsIntakeAcrossIdentityChange(
  previousCandidateId: string | null | undefined,
  nextCandidateId: string | null | undefined,
): boolean {
  return !previousCandidateId && Boolean(nextCandidateId);
}
