import type { ApplicationTurn } from '../../../shared/applicationTurn';
import type { FollowUpStatus } from '../../../shared/followUpPolicy';
import { pluralRu } from '../../../shared/pluralRu';
import { SKIP_REASONS } from '../../../shared/skipReasons';

/**
 * The one line on a kanban card that says whose move it is (mockup
 * `.waiting`, B248/B251 S3). Pure so the copy is unit-tested without
 * mounting `ResponsesBoard`.
 */
export interface WaitingLabelInput {
  readonly stage: string;
  readonly whoseTurn: ApplicationTurn;
  readonly hasMaterials: boolean;
  readonly followUp: FollowUpStatus | null;
  readonly nearestInterviewNeedsPrep: boolean;
  readonly closedReason: string | null;
}

export interface WaitingLabel {
  readonly text: string;
  /** `null` once the card is closed — nobody's turn any more. */
  readonly on: 'you' | 'them' | null;
}

function closedLabel(stage: string, closedReason: string | null): WaitingLabel {
  const reasonLabel =
    SKIP_REASONS.find((reason) => reason.id === closedReason)?.label ??
    (closedReason === 'company_declined' ? 'отказ компании' : null);
  const prefix = stage === 'rejected' ? 'Отказ' : 'Архив';
  return { text: reasonLabel ? `${prefix} · ${reasonLabel}` : `${prefix} · причина не указана`, on: null };
}

function candidateTurnLabel(input: WaitingLabelInput): string {
  if (input.stage === 'saved' && !input.hasMaterials) return 'Соберите письмо';
  if (input.followUp?.urgency === 'stale') return 'Follow-up просрочен';
  if (input.followUp?.urgency === 'due') {
    const days = input.followUp.daysSinceContact;
    return `Follow-up сегодня · ${pluralRu(days, ['день', 'дня', 'дней'])}`;
  }
  if (input.nearestInterviewNeedsPrep) return 'Подготовиться к интервью';
  if (input.stage === 'offer') return 'Примите решение по офферу';
  return 'Ваш ход';
}

function companyTurnLabel(input: WaitingLabelInput): string {
  if (input.followUp?.urgency === 'upcoming') return 'Отправлен · рано для follow-up';
  return 'Ждём ответа компании';
}

/** Architecture.md §3 "чья очередь хода" rendered as the card's own copy. */
export function waitingLabel(input: WaitingLabelInput): WaitingLabel {
  if (input.whoseTurn === null) return closedLabel(input.stage, input.closedReason);
  if (input.whoseTurn === 'candidate') return { text: candidateTurnLabel(input), on: 'you' };
  return { text: companyTurnLabel(input), on: 'them' };
}
