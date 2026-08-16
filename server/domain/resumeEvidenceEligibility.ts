/**
 * The single rule that decides whether a dossier memory may become a resume
 * claim. Both sides of the boundary use it: the engine drops ineligible
 * evidence into `excludedEvidenceIds`, and Resume Studio must not offer the
 * candidate an option the engine will silently refuse — a picker that lists
 * unconfirmed material and then quietly discards it is exactly the dishonest
 * display `docs/agents/design-system.md` §7 forbids.
 *
 * Dependency-free on purpose: it is imported by the browser bundle as well as
 * the server.
 */
export interface ResumeEvidenceCandidate {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly statement: string;
  readonly sourceMessageIds: readonly string[];
  readonly sensitive: boolean;
}

export type ResumeEvidenceIneligibilityReason =
  | 'empty'
  | 'not-a-fact'
  | 'not-confirmed'
  | 'sensitive'
  | 'no-provenance';

export function isResumeEvidenceEligible(
  evidence: ResumeEvidenceCandidate,
): boolean {
  return resumeEvidenceIneligibilityReason(evidence) === null;
}

/**
 * Returns why the memory cannot be used, so the interface can say it in words
 * instead of leaving an unexplained gap.
 */
export function resumeEvidenceIneligibilityReason(
  evidence: ResumeEvidenceCandidate,
): ResumeEvidenceIneligibilityReason | null {
  if (evidence.id.trim().length === 0 || evidence.statement.trim().length === 0) {
    return 'empty';
  }
  if (evidence.kind !== 'fact') return 'not-a-fact';
  if (evidence.status !== 'confirmed' && evidence.status !== 'corrected') {
    return 'not-confirmed';
  }
  if (evidence.sensitive) return 'sensitive';
  if (evidence.sourceMessageIds.length === 0) return 'no-provenance';
  return null;
}
