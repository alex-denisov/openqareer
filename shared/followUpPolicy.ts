/**
 * B251, S2 — follow-up trekker policy (architecture.md §3, §6).
 *
 * Replaces the calendar-day formula from `followUpTracker` (client only,
 * `5/8` calendar days) with business days for `standard` and a calendar
 * window for `executive`. The server and the client share this module so
 * "Сегодня" (S4) and the tracker card (S3) never disagree.
 *
 * Timezone: the candidate's timezone is not stored anywhere yet (architecture
 * §7 risk), so callers pass `timezoneOffsetMinutes` from the client's `?tz=`.
 * A local calendar day is the UTC instant shifted by that offset, truncated
 * to a date. Holidays are not modeled.
 */

export type ApplicationProcessProfile = 'standard' | 'executive';
export type FollowUpUrgency = 'upcoming' | 'due' | 'stale';
export type FollowUpSource = 'company_deadline' | 'standard_schedule' | 'executive_window';

export interface FollowUpInput {
  readonly processProfile: ApplicationProcessProfile;
  /** Last of: applied, follow-up sent, company response — the clock reset points. */
  readonly lastContactAt: string;
  /** The deadline the company itself promised. Always wins over the formula. */
  readonly companyDueAt?: string | null;
  readonly now?: string;
  /** Minutes east of UTC, e.g. 180 for Moscow. Defaults to 0 (UTC). */
  readonly timezoneOffsetMinutes?: number;
}

export interface FollowUpStatus {
  readonly dueAt: string;
  readonly urgency: FollowUpUrgency;
  readonly source: FollowUpSource;
  /** Only meaningful for `standard`; `executive` counts calendar days instead. */
  readonly businessDaysSinceContact: number;
}

const STANDARD_FIRST_REMINDER_DAYS = 5;
const STANDARD_SECOND_REMINDER_DAYS = 8;
const STANDARD_STALE_AFTER_DAYS = 10;
const EXECUTIVE_WINDOW_OPENS_DAYS = 7;
const EXECUTIVE_WINDOW_CLOSES_DAYS = 10;

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

function addCalendarDays(fromIso: string, days: number, timezoneOffsetMinutes = 0): string {
  return localDayToIso(localDayIndex(fromIso, timezoneOffsetMinutes) + days, timezoneOffsetMinutes);
}

function urgencyFromDeadline(now: string, dueAt: string): FollowUpUrgency {
  return new Date(now).getTime() >= new Date(dueAt).getTime() ? 'due' : 'upcoming';
}

function standardFollowUp(
  lastContactAt: string,
  now: string,
  timezoneOffsetMinutes: number,
): FollowUpStatus {
  const elapsed = businessDaysBetween(lastContactAt, now, timezoneOffsetMinutes);
  const dueAt =
    elapsed < STANDARD_FIRST_REMINDER_DAYS
      ? addBusinessDays(lastContactAt, STANDARD_FIRST_REMINDER_DAYS, timezoneOffsetMinutes)
      : elapsed < STANDARD_SECOND_REMINDER_DAYS
        ? addBusinessDays(lastContactAt, STANDARD_SECOND_REMINDER_DAYS, timezoneOffsetMinutes)
        : addBusinessDays(lastContactAt, STANDARD_STALE_AFTER_DAYS, timezoneOffsetMinutes);
  const urgency: FollowUpUrgency =
    elapsed >= STANDARD_STALE_AFTER_DAYS
      ? 'stale'
      : elapsed >= STANDARD_FIRST_REMINDER_DAYS
        ? 'due'
        : 'upcoming';
  return { dueAt, urgency, source: 'standard_schedule', businessDaysSinceContact: elapsed };
}

function executiveFollowUp(
  lastContactAt: string,
  now: string,
  timezoneOffsetMinutes: number,
): FollowUpStatus {
  const opensAt = addCalendarDays(lastContactAt, EXECUTIVE_WINDOW_OPENS_DAYS, timezoneOffsetMinutes);
  const closesAt = addCalendarDays(lastContactAt, EXECUTIVE_WINDOW_CLOSES_DAYS, timezoneOffsetMinutes);
  const nowMs = new Date(now).getTime();
  const urgency: FollowUpUrgency =
    nowMs >= new Date(closesAt).getTime()
      ? 'stale'
      : nowMs >= new Date(opensAt).getTime()
        ? 'due'
        : 'upcoming';
  const dueAt = urgency === 'upcoming' ? opensAt : closesAt;
  return {
    dueAt,
    urgency,
    source: 'executive_window',
    businessDaysSinceContact: businessDaysBetween(lastContactAt, now, timezoneOffsetMinutes),
  };
}

/**
 * The company's own promised deadline always wins over the formula
 * (architecture.md §3): a recruiter who says "we'll answer by the 20th"
 * overrides the 5/8/10 schedule and the executive window alike.
 */
export function computeFollowUpStatus(input: FollowUpInput): FollowUpStatus {
  const now = input.now ?? new Date().toISOString();
  const tz = input.timezoneOffsetMinutes ?? 0;
  if (input.companyDueAt) {
    return {
      dueAt: input.companyDueAt,
      urgency: urgencyFromDeadline(now, input.companyDueAt),
      source: 'company_deadline',
      businessDaysSinceContact: businessDaysBetween(input.lastContactAt, now, tz),
    };
  }
  return input.processProfile === 'executive'
    ? executiveFollowUp(input.lastContactAt, now, tz)
    : standardFollowUp(input.lastContactAt, now, tz);
}
