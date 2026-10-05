export const LINKEDIN_EXECUTOR_DAILY_PAGE_LIMIT = 40;
export const LINKEDIN_EXECUTOR_MIN_PAGE_DELAY_MS = 20_000;
export const LINKEDIN_EXECUTOR_MAX_PAGE_DELAY_MS = 60_000;
export const LINKEDIN_EXECUTOR_WINDOW_START_HOUR = 9;
export const LINKEDIN_EXECUTOR_WINDOW_END_HOUR = 21;
export const LINKEDIN_EXECUTOR_TARGET_SCAN_LIMIT = 2_000;

import type { CadenceMode } from './linkedinCadencePolicy';

export type LinkedinPoolExecutorMode = CadenceMode;

export type LinkedinPoolExecutorConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly accountId: string;
      readonly timezone: string;
      readonly mode: LinkedinPoolExecutorMode;
    };

export type LinkedinPoolExecutorStatus =
  | 'disabled'
  | 'outside_window'
  | 'window_skipped'
  | 'rest_day'
  | 'daily_limit'
  | 'no_target'
  | 'account_not_ready'
  | 'needs_reauth'
  | 'processed'
  | 'transient_failure'
  | 'stopped';

export interface LinkedinPoolExecutorReport {
  readonly status: LinkedinPoolExecutorStatus;
  readonly pageCount: number;
  readonly recruiterCount: number;
  readonly notification?: 'sent' | 'disabled' | 'failed';
  /** Причина сбоя без данных сессии: «ИмяОшибки: сообщение» или `backoff`. */
  readonly reason?: string;
}

export function readLinkedinPoolExecutorConfig(
  environment: NodeJS.ProcessEnv,
): LinkedinPoolExecutorConfig {
  const enabledValue = environment.OPENQAREER_LINKEDIN_POOL_EXECUTOR_ENABLED?.trim().toLowerCase();
  if (!enabledValue || enabledValue === 'false') return { enabled: false };
  if (enabledValue !== 'true') throw new Error('linkedin_pool_executor_flag_invalid');

  const accountId = environment.OPENQAREER_LINKEDIN_POOL_EXECUTOR_ACCOUNT_ID?.trim();
  if (!accountId || !isUuid(accountId)) {
    throw new Error('linkedin_pool_executor_account_id_required');
  }
  const timezone = environment.OPENQAREER_LINKEDIN_POOL_EXECUTOR_TIMEZONE?.trim();
  if (!timezone || !isValidTimezone(timezone)) {
    throw new Error('linkedin_pool_executor_timezone_invalid');
  }
  if (
    !environment.OPENQAREER_TELEGRAM_BOT_TOKEN?.trim() ||
    !environment.OPENQAREER_TELEGRAM_OWNER_CHAT_ID?.trim()
  ) {
    throw new Error('linkedin_pool_executor_owner_telegram_required');
  }
  const rawMode = environment.OPENQAREER_LINKEDIN_POOL_EXECUTOR_MODE?.trim().toLowerCase();
  const mode = (rawMode || 'warmup') as LinkedinPoolExecutorMode;
  if (mode !== 'warmup' && mode !== 'active_search' && mode !== 'scout_pool') {
    throw new Error('linkedin_pool_executor_mode_invalid');
  }
  if (mode !== 'warmup' && !isHighVolumeAllowed(environment)) {
    throw new Error('linkedin_pool_executor_high_volume_not_allowed');
  }
  return { enabled: true, accountId, timezone, mode };
}

/** Режимы выше `warmup` (150–500 страниц в сутки) включаются отдельным явным флагом владельца. */
function isHighVolumeAllowed(environment: NodeJS.ProcessEnv): boolean {
  return (
    environment.OPENQAREER_LINKEDIN_POOL_EXECUTOR_ALLOW_HIGH_VOLUME?.trim().toLowerCase() === 'true'
  );
}

export function isLinkedinExecutorWithinHours(now: Date, timezone: string): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  return hour >= LINKEDIN_EXECUTOR_WINDOW_START_HOUR && hour < LINKEDIN_EXECUTOR_WINDOW_END_HOUR;
}

export function linkedinLocalDayStart(now: Date, timezone: string): Date {
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = Number(dateParts.find((part) => part.type === 'year')?.value);
  const month = Number(dateParts.find((part) => part.type === 'month')?.value);
  const day = Number(dateParts.find((part) => part.type === 'day')?.value);
  const midnightGuess = new Date(Date.UTC(year, month - 1, day));
  return new Date(midnightGuess.getTime() - timezoneOffsetMs(midnightGuess, timezone));
}

export function linkedinExecutorPageDelayMs(random: () => number = Math.random): number {
  const sample = random();
  const bounded = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0.5;
  return (
    LINKEDIN_EXECUTOR_MIN_PAGE_DELAY_MS +
    Math.round(
      bounded * (LINKEDIN_EXECUTOR_MAX_PAGE_DELAY_MS - LINKEDIN_EXECUTOR_MIN_PAGE_DELAY_MS),
    )
  );
}

/** Страниц на одну компанию (B369): поиск компании, страница компании, поиск людей. */
export const LINKEDIN_EXECUTOR_PAGES_PER_COMPANY = 3;

export function hasLinkedinExecutorDailyCapacity(pageCount: number): boolean {
  return pageCount + LINKEDIN_EXECUTOR_PAGES_PER_COMPANY <= LINKEDIN_EXECUTOR_DAILY_PAGE_LIMIT;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function timezoneOffsetMs(date: Date, timezone: string): number {
  const value = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value;
  const match = /^GMT(?:(?<sign>[+-])(?<hour>\d{2}):(?<minute>\d{2}))?$/u.exec(value ?? '');
  if (!match) throw new Error('linkedin_pool_executor_timezone_offset_invalid');
  const minutes = Number(match.groups?.hour ?? 0) * 60 + Number(match.groups?.minute ?? 0);
  return (match.groups?.sign === '-' ? -minutes : minutes) * 60_000;
}
