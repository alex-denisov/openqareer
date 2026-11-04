import { careerActionProposalSchema, coachTurnResultSchema, type CoachTurnResult } from '../../domain/coach';
import { withStoredMemoryCap } from './storedTurnMemoryCap';

function withoutOutdatedProposals(stored: unknown): unknown {
  if (!stored || typeof stored !== 'object') return stored;
  const record = stored as { actionProposals?: unknown };
  if (!Array.isArray(record.actionProposals)) return stored;
  return {
    ...record,
    actionProposals: record.actionProposals.filter(
      (proposal) => careerActionProposalSchema.safeParse(proposal).success,
    ),
  };
}

/**
 * 04.11: a turn of 05.09 kept a `resume.revise` proposal without the profile target the schema
 * now demands, and every read of that candidate (`/me`, memory, turns, resume) answered 422. The
 * schema is both the provider contract and the read-back contract, so a proposal it no longer
 * accepts is dropped from the read: nothing can act on it anyway. The stored row stays as it is.
 */
export function parseStoredTurnResult(stored: unknown): CoachTurnResult {
  const capped = withStoredMemoryCap(stored);
  const parsed = coachTurnResultSchema.safeParse(capped);
  if (parsed.success) return parsed.data;
  return coachTurnResultSchema.parse(withoutOutdatedProposals(capped));
}

/** One unreadable turn costs its own result, not the candidate's screens. No content is logged. */
export function reportUnreadableStoredTurn(idempotencyKey: string, error: unknown): void {
  console.warn(
    JSON.stringify({
      event: 'stored-turn-unreadable',
      idempotencyKey,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }),
  );
}
