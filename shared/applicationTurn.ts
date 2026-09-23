import type { ApplicationStage } from './applicationStage';
import type { FollowUpUrgency } from './followUpPolicy';

/**
 * "Чья очередь хода" (B251, S2, architecture.md §3). `null` — the card is
 * closed (`rejected`/`archived`) and has no turn at all.
 *
 * The "company asked something and there is no later event" rule from the
 * architecture is not implemented here: `application_events.kind` has no
 * `company_question` value yet, so there is nothing to detect it from. Once
 * that event kind exists this function gains one more input.
 */
export type ApplicationTurn = 'candidate' | 'company' | null;

export interface WhoseTurnInput {
  readonly stage: ApplicationStage;
  /** `null` when the card has no follow-up tracked yet (e.g. still `saved`). */
  readonly followUpUrgency: FollowUpUrgency | null;
  /** Has a cover letter (or resume) linked via `application_materials`. */
  readonly hasMaterials: boolean;
  /** An interview inside the next 72 hours whose `prep_status` isn't `ready`. */
  readonly upcomingInterviewNeedsPrep: boolean;
}

export function computeApplicationTurn(input: WhoseTurnInput): ApplicationTurn {
  if (input.stage === 'rejected' || input.stage === 'archived') return null;
  if (input.stage === 'saved' && !input.hasMaterials) return 'candidate';
  if (input.followUpUrgency === 'due' || input.followUpUrgency === 'stale') return 'candidate';
  if (input.upcomingInterviewNeedsPrep) return 'candidate';
  if (input.stage === 'offer') return 'candidate';
  return 'company';
}
