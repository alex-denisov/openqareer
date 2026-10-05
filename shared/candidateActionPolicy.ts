import { formatLocalDate } from './timezoneUtils';

export const QUIET_HOURS_START = 23; // 23:00 local time
export const QUIET_HOURS_END = 8; // 08:00 local time

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
