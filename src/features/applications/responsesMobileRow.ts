import { formatInterviewDay, formatInterviewWhen } from '../../../shared/interviewDate';
import { deliveryState } from '../../../shared/applicationStage';
import type { ApplicationView } from './applicationsApi';
import { needsResend } from './responseCardFace';
import { waitingLabel } from './waitingLabel';

export interface MobileDueDate {
  readonly dateTime: string;
  readonly label: string;
}

/** «06.10»: the 390 list never repeats the year (mockup 5, R18). */
export function shortDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

function sameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/**
 * Date of the next step shown on the right of a row: the interview slot or the
 * follow-up due date. A due or overdue reminder reads «сегодня». Rows without a
 * dated step show nothing instead of an invented date.
 */
export function mobileDueDate(
  application: ApplicationView,
  now = new Date(),
): MobileDueDate | null {
  const interviewAt = application.nearestInterview?.scheduledAt;
  if (interviewAt && !Number.isNaN(new Date(interviewAt).getTime())) {
    const date = new Date(interviewAt);
    return {
      dateTime: interviewAt,
      label: sameLocalDay(date, now) ? 'сегодня' : (formatInterviewDay(interviewAt) ?? ''),
    };
  }
  const dueAt = application.followUp?.dueAt;
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  return {
    dateTime: dueAt,
    label: due.getTime() <= now.getTime() || sameLocalDay(due, now) ? 'сегодня' : shortDate(dueAt),
  };
}

function datedLabel(label: string, value: string | null | undefined): string {
  const date = shortDate(value);
  return date ? label + ' ' + date : label;
}

export function mobileStatusLabel(application: ApplicationView): string {
  const stage = application.stage;
  if (stage === 'saved') return 'Черновик';
  if (stage === 'applied') {
    const state = deliveryState(stage, application.deliveryReceipt ?? null);
    if (state === 'delivered') {
      return datedLabel('Доставлено', application.deliveryReceiptRecordedAt);
    }
    if (state === 'failed') return 'Не доставлено';
    return 'Пробовали отправить';
  }
  if (stage === 'interview') {
    // The stage-change date is not the interview date (B511 G3b item 4): without a
    // slot the row says so, in the same words as the 1440 status pill.
    const when = formatInterviewWhen(application.nearestInterview?.scheduledAt);
    return when ? 'Интервью ' + when : 'Интервью, дата не указана';
  }
  const labels = {
    responded: 'Ответ',
    interview: 'Интервью',
    offer: 'Оффер',
    rejected: 'Отказ',
    archived: 'Архив',
  } as const;
  return datedLabel(labels[stage], application.stageChangedAt);
}

export interface MobileNextStep {
  readonly label: string;
  /** Mockup 5 `.om-next.is-hot`: only the candidate's real move is in the accent colour. */
  readonly hot: boolean;
}

export function mobileNextStep(application: ApplicationView): MobileNextStep {
  if (needsResend(application)) return { label: 'Повторить отклик', hot: true };
  const step = waitingLabel({
    stage: application.stage,
    whoseTurn: application.whoseTurn,
    hasMaterials: application.materials.coverLetter || application.materials.resume,
    followUp: application.followUp,
    nearestInterviewNeedsPrep:
      application.nearestInterview !== null && application.nearestInterview.prepStatus !== 'ready',
    closedReason: application.closedReason,
  });
  return { label: shortStepLabel(step.text), hot: step.on === 'you' };
}

function shortStepLabel(step: string): string {
  if (step === 'Напоминание компании просрочено') return 'Напомнить компании';
  if (step.startsWith('Напоминание компании сегодня')) return 'Напомнить сегодня';
  if (step === 'Подготовиться к интервью') return 'Подготовиться';
  if (step === 'Соберите письмо') return 'Собрать письмо';
  if (step === 'Примите решение по офферу') return 'Решить по офферу';
  if (step === 'Ждём ответа компании' || step.startsWith('Отправлен · рано')) return 'Ждать ответа';
  if (step === 'Ваш ход') return 'Выбрать шаг';
  return step;
}
