import { formatLocalDate } from './timezoneUtils';

export const QUIET_HOURS_START = 23; // 23:00 local time
export const QUIET_HOURS_END = 8; // 08:00 local time
export const CANDIDATE_ACTION_PAUSE_MIN_MS = 3_000;
export const CANDIDATE_ACTION_PAUSE_MAX_MS = 30_000;

const PLATFORM_ACTION_DOMAINS = {
  hh: ['hh.ru', 'www.hh.ru'],
  linkedin: ['linkedin.com', 'www.linkedin.com'],
} as const;

/** Allow HTTPS targets only on the platform the candidate explicitly chose. */
export function isAllowedCandidateActionTarget(
  platform: 'hh' | 'linkedin',
  targetUrl: string,
): boolean {
  try {
    const url = new URL(targetUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hostname.endsWith('.')
    ) {
      return false;
    }
    const host = url.hostname.toLowerCase();
    const allowedHosts: readonly string[] = PLATFORM_ACTION_DOMAINS[platform];
    return allowedHosts.includes(host);
  } catch {
    return false;
  }
}

/** Uniform bounded jitter between separate candidate-approved actions. */
export function getCandidateActionPauseMs(random: () => number = Math.random): number {
  const sample = random();
  const boundedSample = Number.isFinite(sample) ? Math.min(0.999999, Math.max(0, sample)) : 0.5;
  const span = CANDIDATE_ACTION_PAUSE_MAX_MS - CANDIDATE_ACTION_PAUSE_MIN_MS + 1;
  return CANDIDATE_ACTION_PAUSE_MIN_MS + Math.floor(boundedSample * span);
}

export interface CandidateDailyLimits {
  readonly maxHhAppliesPerDay: number;
  readonly maxLinkedinEasyAppliesPerDay: number;
  readonly maxHhBoostsPerDay: number;
  readonly minHhBoostIntervalMinutes: number;
}

export const DEFAULT_CANDIDATE_ACTION_LIMITS: CandidateDailyLimits = {
  maxHhAppliesPerDay: 15,
  maxLinkedinEasyAppliesPerDay: 10,
  maxHhBoostsPerDay: 3,
  minHhBoostIntervalMinutes: 240,
};

export const MAX_CANDIDATE_ACTIONS_PER_BATCH =
  DEFAULT_CANDIDATE_ACTION_LIMITS.maxHhAppliesPerDay +
  DEFAULT_CANDIDATE_ACTION_LIMITS.maxLinkedinEasyAppliesPerDay +
  DEFAULT_CANDIDATE_ACTION_LIMITS.maxHhBoostsPerDay;

/** Next local midnight as UTC, for an honest daily-limit reset time. */
export function getCandidateActionResetAt(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  if (![year, month, day].every(Number.isFinite)) return new Date(now.getTime() + 86_400_000).toISOString();

  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const localMidnightUtc = Date.UTC(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth(),
    nextDay.getUTCDate(),
  );
  let guess = localMidnightUtc;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    guess = localMidnightUtc - timezoneOffsetMinutes(new Date(guess), timezone) * 60_000;
  }
  return new Date(guess).toISOString();
}

function timezoneOffsetMinutes(date: Date, timezone: string): number {
  const value = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value;
  const match = value?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/u);
  if (!match) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

export function isWithinQuietHours(date: Date, timezone: string): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
}

export interface CandidateActionUsageSummary {
  readonly localDate: string;
  readonly hhAppliesCount: number;
  readonly linkedinEasyAppliesCount: number;
  readonly hhBoostsCount: number;
  readonly lastHhBoostAt: string | null;
}

export type CandidateActionKind = 'hh_apply' | 'hh_resume_boost' | 'linkedin_easy_apply';

export type CandidateLinkedinSafetyStopReason =
  | 'challenge_required'
  | 'platform_restricted'
  | 'unexpected_page'
  | 'provider_error';

/** Any non-success from a LinkedIn runner is a stop signal; unknowns fail closed. */
export function classifyLinkedinSafetyStopReason(
  signal: string | null | undefined,
): CandidateLinkedinSafetyStopReason {
  const value = (signal ?? '').slice(0, 256).toLowerCase();
  if (/challenge|checkpoint|captcha|verification|login_required|reauth|session_expired/u.test(value)) {
    return 'challenge_required';
  }
  if (/403|429|999|rate.?limit|restrict|forbidden|blocked|access_denied/u.test(value)) {
    return 'platform_restricted';
  }
  if (/unexpected|page|response|html|parse|schema/u.test(value)) {
    return 'unexpected_page';
  }
  return 'provider_error';
}

export function isCandidateLinkedinSafetyStopReason(
  value: string | null | undefined,
): value is CandidateLinkedinSafetyStopReason {
  return (
    value === 'challenge_required' ||
    value === 'platform_restricted' ||
    value === 'unexpected_page' ||
    value === 'provider_error'
  );
}

export interface ActionCapacityVerdict {
  readonly allowed: boolean;
  readonly code?: 'quiet_hours' | 'daily_limit_reached' | 'boost_interval_unexpired';
  readonly message?: string;
}

export function checkActionCapacity(
  kind: CandidateActionKind,
  now: Date,
  timezone: string,
  usage: CandidateActionUsageSummary,
  limits = DEFAULT_CANDIDATE_ACTION_LIMITS,
): ActionCapacityVerdict {
  if (isWithinQuietHours(now, timezone)) {
    return {
      allowed: false,
      code: 'quiet_hours',
      message: 'Тихие часы (23:00–08:00). Действия от имени кандидата в ночное время приостановлены.',
    };
  }

  if (kind === 'hh_apply') {
    if (usage.hhAppliesCount >= limits.maxHhAppliesPerDay) {
      return {
        allowed: false,
        code: 'daily_limit_reached',
        message: `Достигнут суточный лимит откликов на hh.ru (${limits.maxHhAppliesPerDay}).`,
      };
    }
  } else if (kind === 'linkedin_easy_apply') {
    if (usage.linkedinEasyAppliesCount >= limits.maxLinkedinEasyAppliesPerDay) {
      return {
        allowed: false,
        code: 'daily_limit_reached',
        message: `Достигнут суточный лимит Easy Apply в LinkedIn (${limits.maxLinkedinEasyAppliesPerDay}).`,
      };
    }
  } else if (kind === 'hh_resume_boost') {
    if (usage.hhBoostsCount >= limits.maxHhBoostsPerDay) {
      return {
        allowed: false,
        code: 'daily_limit_reached',
        message: `Достигнут суточный лимит поднятия резюме на hh.ru (${limits.maxHhBoostsPerDay}).`,
      };
    }
    if (usage.lastHhBoostAt) {
      const lastBoostMs = Date.parse(usage.lastHhBoostAt);
      const elapsedMinutes = (now.getTime() - lastBoostMs) / 60_000;
      if (elapsedMinutes < limits.minHhBoostIntervalMinutes) {
        const waitMinutes = Math.ceil(limits.minHhBoostIntervalMinutes - elapsedMinutes);
        return {
          allowed: false,
          code: 'boost_interval_unexpired',
          message: `Поднятие резюме доступно раз в 4 часа. Подождите ещё ${waitMinutes} мин.`,
        };
      }
    }
  }

  return { allowed: true };
}

export { formatLocalDate };
