import { deliveryState } from '../../../shared/applicationStage';
import type { ApplicationView } from './applicationsApi';

/**
 * The card face of mockup 5 `.card` (B484 R1/R2): one status pill with an
 * icon and a date, and one concrete next step with whom and by when. Pure
 * so the copy is unit-tested without mounting the board; the selected
 * response panel reuses it for its chip and next-step line.
 */
export type StatusTone =
  'draft' | 'sent' | 'ok' | 'fail' | 'reply' | 'interview' | 'offer' | 'closed';

export interface ResponseStatusPill {
  readonly tone: StatusTone;
  readonly label: string;
}

export interface ResponseNextStep {
  readonly text: string;
  /** Candidate's move — the card is highlighted and counted as "нужно действие". */
  readonly yours: boolean;
}

type FaceInput = Pick<
  ApplicationView,
  | 'stage'
  | 'stageChangedAt'
  | 'appliedAt'
  | 'whoseTurn'
  | 'materials'
  | 'followUp'
  | 'followUpDueAt'
  | 'nearestInterview'
  | 'deliveryReceipt'
  | 'deliveryReceiptRecordedAt'
  | 'closedReason'
>;

export function formatDayMonth(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

export function formatDayMonthTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${formatDayMonth(value)}, ${time}`;
}

function withDate(label: string, date: string | null): string {
  return date ? `${label} ${date}` : label;
}

export function responseStatusPill(input: FaceInput): ResponseStatusPill {
  switch (input.stage) {
    case 'saved':
      return { tone: 'draft', label: 'Черновик, не отправлено' };
    case 'applied':
      return appliedPill(input);
    case 'responded':
      return { tone: 'reply', label: withDate('Ответ', formatDayMonth(input.stageChangedAt)) };
    case 'interview': {
      const at = formatDayMonthTime(input.nearestInterview?.scheduledAt);
      return { tone: 'interview', label: at ? `Интервью ${at}` : 'Интервью, дата не указана' };
    }
    case 'offer':
      return { tone: 'offer', label: withDate('Оффер', formatDayMonth(input.stageChangedAt)) };
    case 'rejected':
      return { tone: 'closed', label: withDate('Отказ', formatDayMonth(input.stageChangedAt)) };
    default:
      return { tone: 'closed', label: withDate('Закрыто', formatDayMonth(input.stageChangedAt)) };
  }
}

function appliedPill(input: FaceInput): ResponseStatusPill {
  const receipt = input.deliveryReceipt ?? null;
  const state = deliveryState('applied', receipt);
  if (state === 'failed') {
    const reason = (receipt?.value ?? '').replace(/^\s*не доставлено\s*[:.]?\s*/iu, '');
    return { tone: 'fail', label: `Не доставлено: ${reason || 'причина не указана'}` };
  }
  if (state === 'delivered') {
    return {
      tone: 'ok',
      label: withDate('Доставлено', formatDayMonth(input.deliveryReceiptRecordedAt)),
    };
  }
  return { tone: 'sent', label: withDate('Отправлено', formatDayMonth(input.appliedAt)) };
}

const REMINDER_URGENCIES: ReadonlySet<string> = new Set(['due', 'overdue', 'stale']);

/**
 * A reminder only makes sense after a confirmed delivery: a failed send, or an
 * unconfirmed one at the point a reminder would be due, asks to resend (B511 G3 item 5).
 */
export function needsResend(
  input: Pick<ApplicationView, 'stage' | 'deliveryReceipt' | 'followUp'>,
): boolean {
  if (input.stage !== 'applied') return false;
  const state = deliveryState('applied', input.deliveryReceipt ?? null);
  if (state === 'failed') return true;
  return state === 'attempted' && REMINDER_URGENCIES.has(input.followUp?.urgency ?? '');
}

/**
 * The recruiter's name is not in the application model yet, so the step
 * names the company as the addressee instead of inventing a person.
 */
export function responseNextStep(input: FaceInput): ResponseNextStep {
  if (input.whoseTurn === null) return { text: 'Закрыт, шагов нет', yours: false };
  const due = formatDayMonth(input.followUp?.dueAt ?? input.followUpDueAt);
  if (input.stage === 'saved') {
    const hasLetter = input.materials.coverLetter || input.materials.resume;
    const action = hasLetter ? 'Одобрить письмо' : 'Собрать письмо';
    return { text: due ? `${action} до ${due}` : action, yours: true };
  }
  if (needsResend(input)) return { text: 'Повторить отклик', yours: true };
  const urgency = input.followUp?.urgency;
  if (urgency === 'due') return { text: 'Напомнить компании сегодня', yours: true };
  if (urgency === 'overdue' || urgency === 'stale') {
    return { text: withDate('Напомнить компании, срок был', due), yours: true };
  }
  if (input.stage === 'interview') return interviewStep(input, due);
  if (input.stage === 'offer') {
    return { text: due ? `Ответить до ${due}` : 'Ответить на оффер', yours: true };
  }
  if (input.whoseTurn === 'candidate') {
    return { text: due ? `Ответить компании до ${due}` : 'Ответить компании', yours: true };
  }
  return { text: due ? `Ждать ответа до ${due}` : 'Ждать ответа компании', yours: false };
}

function interviewStep(input: FaceInput, due: string | null): ResponseNextStep {
  const interview = input.nearestInterview;
  if (interview && interview.prepStatus !== 'ready') {
    return {
      text: withDate('Подготовиться к интервью', formatDayMonth(interview.scheduledAt)),
      yours: true,
    };
  }
  if (interview)
    return { text: withDate('Интервью', formatDayMonth(interview.scheduledAt)), yours: false };
  if (input.whoseTurn === 'candidate') return { text: 'Заполнить дебриф', yours: true };
  return { text: due ? `Ждать ответа до ${due}` : 'Ждать ответа компании', yours: false };
}
