import type { ApplicationStage } from './applicationStage';

/**
 * The stage control only asks for a day and stores it as UTC midnight, so midnight UTC means
 * «no time chosen». An interview really set for exactly 03:00 Moscow time is not a case the
 * form can produce.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.0+)?Z)?$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isDateOnlyInstant(value: string): boolean {
  return DATE_ONLY.test(value);
}

function zoneFor(value: string, timezone?: string): { timeZone?: string } {
  if (isDateOnlyInstant(value)) return { timeZone: 'UTC' };
  return timezone ? { timeZone: timezone } : {};
}

/** «01.12»: the interview's own day, never shifted by the viewer's time zone when it has no time. */
export function formatInterviewDay(
  value: string | null | undefined,
  timezone?: string,
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    ...zoneFor(value, timezone),
  });
}

/** «01.12, 14:00», or «01.12» when no time was chosen. */
export function formatInterviewWhen(
  value: string | null | undefined,
  timezone?: string,
): string | null {
  const day = formatInterviewDay(value, timezone);
  if (!day || !value || isDateOnlyInstant(value)) return day;
  const time = new Date(value).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    ...zoneFor(value, timezone),
  });
  return `${day}, ${time}`;
}

/** A timed interview ends at its time; one without a time lasts through its whole day. */
export function interviewDayIsOver(scheduledAt: string, now: string): boolean {
  const start = Date.parse(scheduledAt);
  const end = isDateOnlyInstant(scheduledAt) ? start + DAY_MS - 1 : start;
  return Date.parse(now) > end;
}

/**
 * A rollback keeps the interview row (date, prep notes, debrief) and only stops showing it:
 * a slot belongs on the response while it is at «Интервью», or at «Оффер», where a last round
 * can still be ahead. Earlier and closed stages have no interview to show.
 */
export function stageShowsInterview(stage: ApplicationStage): boolean {
  return stage === 'interview' || stage === 'offer';
}
