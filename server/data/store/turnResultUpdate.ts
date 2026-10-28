import type { DatabaseSync } from 'node:sqlite';
import { coachTurnResultSchema, type CoachTurnResult } from '../../domain/coach';
import type { SealedText } from '../sealedText';
import { turnAssociatedData } from './shared';

/**
 * Rewrites a completed turn's stored result (28.10): the expert/strategist analysis
 * joins the consultant's reply that was stored first. Re-parsed by the same schema
 * the turn is read with, so a merged result can never break the cabinet.
 */
export function updateStoredTurnResult(input: {
  readonly database: DatabaseSync;
  readonly sealedText: SealedText;
  readonly candidateId: string;
  readonly key: string;
  readonly turn: { readonly status: string; readonly result: CoachTurnResult | null } | null;
  readonly update: (result: CoachTurnResult) => CoachTurnResult;
}): boolean {
  if (input.turn?.status !== 'completed' || !input.turn.result) return false;
  const next = coachTurnResultSchema.parse(input.update(input.turn.result));
  input.database
    .prepare(
      `UPDATE turns SET result_cipher = ?, updated_at = ?
       WHERE candidate_id = ? AND idempotency_key = ? AND status = 'completed'`,
    )
    .run(
      input.sealedText.seal(
        JSON.stringify(next),
        turnAssociatedData(input.candidateId, input.key),
      ),
      new Date().toISOString(),
      input.candidateId,
      input.key,
    );
  return true;
}
