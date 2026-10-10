import {
  DEFAULT_CANDIDATE_ACTION_LIMITS,
} from '../../shared/candidateActionPolicy';
import { DEFAULT_ACCOUNT_TIMEZONE, isValidTimezone } from '../../shared/timezoneUtils';

export type CandidateAutomationPlatform = 'hh' | 'linkedin';

export interface CandidateAutomationWindow {
  readonly start: string;
  readonly end: string;
  readonly days?: readonly number[];
}

export interface CandidateAutomationSchedule {
  readonly timezone: string;
  readonly dailyLimits: Readonly<Record<CandidateAutomationPlatform, number>>;
  readonly minPauseMinutes: number;
  readonly maxPauseMinutes: number;
  readonly sendWindows: Readonly<Record<CandidateAutomationPlatform, CandidateAutomationWindow>>;
  readonly quietWindows: readonly CandidateAutomationWindow[];
  readonly excludedDates: readonly string[];
  readonly breakAfterSent: number;
  readonly breakMinutes: number;
  readonly stopAfterErrors: number;
}

export const DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE: CandidateAutomationSchedule = {
  timezone: DEFAULT_ACCOUNT_TIMEZONE,
  dailyLimits: {
    hh: DEFAULT_CANDIDATE_ACTION_LIMITS.maxHhAppliesPerDay,
    linkedin: DEFAULT_CANDIDATE_ACTION_LIMITS.maxLinkedinEasyAppliesPerDay,
  },
  minPauseMinutes: 2,
  maxPauseMinutes: 9,
  sendWindows: {
    hh: { start: '10:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    linkedin: { start: '09:00', end: '17:00', days: [1, 2, 3, 4] },
  },
  quietWindows: [
    { start: '22:00', end: '08:00' },
    { start: '13:00', end: '14:00' },
  ],
  excludedDates: [],
  breakAfterSent: 8,
  breakMinutes: 120,
  stopAfterErrors: 3,
};

export type CandidateAutomationScheduleValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string };

export function validateCandidateAutomationSchedule(
  value: CandidateAutomationSchedule,
): CandidateAutomationScheduleValidation {
  if (!isValidTimezone(value.timezone)) return { valid: false, reason: 'invalid_timezone' };
  if (value.dailyLimits.hh < 1 || value.dailyLimits.hh > DEFAULT_CANDIDATE_ACTION_LIMITS.maxHhAppliesPerDay ||
      value.dailyLimits.linkedin < 1 || value.dailyLimits.linkedin > DEFAULT_CANDIDATE_ACTION_LIMITS.maxLinkedinEasyAppliesPerDay) {
    return { valid: false, reason: 'daily_limit_exceeds_executor' };
  }
  if (value.minPauseMinutes < 2 || value.maxPauseMinutes > 9 || value.minPauseMinutes > value.maxPauseMinutes) {
    return { valid: false, reason: 'pause_out_of_range' };
  }
  if (!validWindow(value.sendWindows.hh) || !validWindow(value.sendWindows.linkedin) ||
      value.quietWindows.length > 8 || value.quietWindows.some((window) => !validWindow(window)) ||
      value.excludedDates.length > 100 || value.excludedDates.some((date) => !/^\d{4}-\d{2}-\d{2}$/u.test(date))) {
    return { valid: false, reason: 'invalid_schedule_window' };
  }
  if (value.breakAfterSent < 1 || value.breakAfterSent > 20 || value.breakMinutes < 30 ||
      value.breakMinutes > 240 || value.stopAfterErrors < 1 || value.stopAfterErrors > 5) {
    return { valid: false, reason: 'invalid_safety_threshold' };
  }
  return { valid: true };
}

export function randomCandidateAutomationPauseMs(random: () => number = Math.random): number {
  const sample = random();
  const bounded = Number.isFinite(sample) ? Math.max(0, Math.min(0.999999, sample)) : 0.5;
  const span = DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE.maxPauseMinutes -
    DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE.minPauseMinutes + 1;
  return (DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE.minPauseMinutes + Math.floor(bounded * span)) * 60_000;
}

export function dailyCandidateAutomationLimit(
  candidateId: string,
  localDate: string,
  platform: CandidateAutomationPlatform,
  schedule: CandidateAutomationSchedule = DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE,
): number {
  const configured = schedule.dailyLimits[platform];
  const variation = stableDayFraction(`${candidateId}:${localDate}:${platform}`);
  return Math.min(configured, Math.max(1, Math.round(configured * (0.8 + variation * 0.4))));
}

export function nextCandidateAutomationSendAt(
  now: Date,
  platform: CandidateAutomationPlatform,
  schedule: CandidateAutomationSchedule,
  random: () => number = Math.random,
): Date {
  const delay = randomPauseMs(schedule, random);
  return nextOpenMinute(new Date(now.getTime() + delay), platform, schedule);
}

function randomPauseMs(schedule: CandidateAutomationSchedule, random: () => number): number {
  const sample = random();
  const bounded = Number.isFinite(sample) ? Math.max(0, Math.min(0.999999, sample)) : 0.5;
  return (schedule.minPauseMinutes + Math.floor(bounded * (schedule.maxPauseMinutes - schedule.minPauseMinutes + 1))) * 60_000;
}

function nextOpenMinute(start: Date, platform: CandidateAutomationPlatform, schedule: CandidateAutomationSchedule): Date {
  const minute = Math.ceil(start.getTime() / 60_000) * 60_000;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: schedule.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (let step = 0; step <= 8 * 24 * 60; step += 1) {
    const candidate = new Date(minute + step * 60_000);
    if (isOpenMinute(candidate, platform, schedule, formatter)) return candidate;
  }
  return new Date(minute + 8 * 24 * 60 * 60_000);
}

function isOpenMinute(
  date: Date,
  platform: CandidateAutomationPlatform,
  schedule: CandidateAutomationSchedule,
  formatter: Intl.DateTimeFormat,
): boolean {
  const local = localParts(date, formatter);
  if (!local || schedule.excludedDates.includes(local.date)) return false;
  const sendWindow = schedule.sendWindows[platform];
  if (!windowContainsMinute(sendWindow, local.weekday, local.minute)) return false;
  return !schedule.quietWindows.some((window) => windowContainsMinute(window, local.weekday, local.minute));
}

function windowContainsMinute(window: CandidateAutomationWindow, weekday: number, minute: number): boolean {
  const start = parseClock(window.start);
  const end = parseClock(window.end);
  if (start === null || end === null || start === end) return false;
  const crossesMidnight = start > end;
  const applies = window.days === undefined || window.days.includes(
    crossesMidnight && minute < end ? (weekday + 6) % 7 : weekday,
  );
  if (!applies) return false;
  return crossesMidnight ? minute >= start || minute < end : minute >= start && minute < end;
}

function localParts(date: Date, formatter: Intl.DateTimeFormat): { date: string; weekday: number; minute: number } | null {
  const parts = formatter.formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value('weekday') ?? '');
  const hour = Number(value('hour'));
  const minute = Number(value('minute'));
  if (weekday < 0 || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { date: `${value('year')}-${value('month')}-${value('day')}`, weekday, minute: hour * 60 + minute };
}

function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

function validWindow(window: CandidateAutomationWindow): boolean {
  return parseClock(window.start) !== null && parseClock(window.end) !== null &&
    window.start !== window.end && (window.days === undefined ||
      (window.days.length > 0 && window.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)));
}

function stableDayFraction(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  return (hash >>> 0) / 4_294_967_296;
}
