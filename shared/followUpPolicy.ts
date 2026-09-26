/**
 * B251, S2 — follow-up trekker policy (architecture.md §3, §6).
 *
 * The server and the client share the UTC calendar-day schedule so
 * "Сегодня" (S4) and the tracker card (S3) never disagree.
 *
 * Reminders fall on calendar days 5 and 8; the status becomes stale on day 14.
 * A company-provided deadline still takes precedence.
 */

export type ApplicationProcessProfile = 'standard' | 'executive';
export type FollowUpUrgency = 'upcoming' | 'due' | 'stale';
export type FollowUpSource = 'company_deadline' | 'standard_schedule';

export interface FollowUpInput {
  readonly processProfile: ApplicationProcessProfile;
  /** Last of: applied, follow-up sent, company response — the clock reset points. */
  readonly lastContactAt: string;
  /** The deadline the company itself promised. Always wins over the formula. */
  readonly companyDueAt?: string | null;
  readonly now?: string;
  /** Retained for older callers; reminder dates are calculated in UTC. */
  readonly timezoneOffsetMinutes?: number;
}

export interface FollowUpStatus {
  readonly dueAt: string;
  readonly urgency: FollowUpUrgency;
  readonly source: FollowUpSource;
  readonly daysSinceContact: number;
}

const STANDARD_FIRST_REMINDER_DAYS = 5;
const STANDARD_SECOND_REMINDER_DAYS = 8;
const STANDARD_STALE_AFTER_DAYS = 14;

/** Local calendar date (midnight UTC of the shifted instant) as epoch days. */
function localDayIndex(iso: string, timezoneOffsetMinutes: number): number {
  const instant = new Date(iso).getTime();
  const shifted = instant + timezoneOffsetMinutes * 60_000;
  return Math.floor(shifted / 86_400_000);
}

function localDayToIso(dayIndex: number, timezoneOffsetMinutes: number): string {
  const utcMidnight = dayIndex * 86_400_000 - timezoneOffsetMinutes * 60_000;
  return new Date(utcMidnight).toISOString();
}

function isWeekend(dayIndex: number): boolean {
  // 1970-01-01 (epoch day 0) is a Thursday: (dayIndex + 3) % 7 gives Mon=0..Sun=6.
  const weekday = ((dayIndex + 3) % 7 + 7) % 7;
  return weekday >= 5;
}

/** Whole business days strictly after `fromIso`'s local date, up to `toIso`'s. */
export function businessDaysBetween(
  fromIso: string,
  toIso: string,
  timezoneOffsetMinutes = 0,
): number {
  const from = localDayIndex(fromIso, timezoneOffsetMinutes);
  const to = localDayIndex(toIso, timezoneOffsetMinutes);
  let count = 0;
  for (let day = from + 1; day <= to; day += 1) {
    if (!isWeekend(day)) count += 1;
  }
  return count;
}

/** The local calendar date `businessDays` weekdays after `fromIso`. */
export function addBusinessDays(
  fromIso: string,
  businessDays: number,
  timezoneOffsetMinutes = 0,
): string {
  let day = localDayIndex(fromIso, timezoneOffsetMinutes);
  let remaining = businessDays;
  while (remaining > 0) {
    day += 1;
    if (!isWeekend(day)) remaining -= 1;
  }
  return localDayToIso(day, timezoneOffsetMinutes);
}

function utcDayIndex(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 86_400_000);
}

function utcDayToIso(dayIndex: number): string {
  return new Date(dayIndex * 86_400_000).toISOString();
}

function calendarDaysBetween(fromIso: string, toIso: string): number {
  return utcDayIndex(toIso) - utcDayIndex(fromIso);
}

function addUtcCalendarDays(fromIso: string, days: number): string {
  return utcDayToIso(utcDayIndex(fromIso) + days);
}

function urgencyFromDeadline(now: string, dueAt: string): FollowUpUrgency {
  return new Date(now).getTime() >= new Date(dueAt).getTime() ? 'due' : 'upcoming';
}

function standardFollowUp(lastContactAt: string, now: string): FollowUpStatus {
  const elapsed = calendarDaysBetween(lastContactAt, now);
  const dueAt =
    elapsed < STANDARD_FIRST_REMINDER_DAYS
      ? addUtcCalendarDays(lastContactAt, STANDARD_FIRST_REMINDER_DAYS)
      : elapsed < STANDARD_SECOND_REMINDER_DAYS
        ? addUtcCalendarDays(lastContactAt, STANDARD_SECOND_REMINDER_DAYS)
        : addUtcCalendarDays(lastContactAt, STANDARD_STALE_AFTER_DAYS);
  const urgency: FollowUpUrgency =
    elapsed >= STANDARD_STALE_AFTER_DAYS
      ? 'stale'
      : elapsed >= STANDARD_FIRST_REMINDER_DAYS
        ? 'due'
        : 'upcoming';
  return { dueAt, urgency, source: 'standard_schedule', daysSinceContact: elapsed };
}

/**
 * The company's own promised deadline always wins over the formula
 * (architecture.md §3): a recruiter who says "we'll answer by the 20th"
 * overrides the 5/8/14 schedule.
 */
export function computeFollowUpStatus(input: FollowUpInput): FollowUpStatus {
  const now = input.now ?? new Date().toISOString();
  if (input.companyDueAt) {
    return {
      dueAt: input.companyDueAt,
      urgency: urgencyFromDeadline(now, input.companyDueAt),
      source: 'company_deadline',
      daysSinceContact: calendarDaysBetween(input.lastContactAt, now),
    };
  }
  return standardFollowUp(input.lastContactAt, now);
}
