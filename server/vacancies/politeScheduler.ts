/**
 * Polite per-source scheduling engine (B204).
 *
 * Enforces per-source manners:
 * 1. Exponential backoff with ceiling on errors.
 * 2. Strict respect for Retry-After headers (delta-seconds or HTTP-date).
 * 3. Hourly request budget limiting per domain/source.
 * 4. Robots.txt crawl-delay and RFC 9309 directive respect.
 * 5. Dynamic interval adaptation based on feed update activity.
 */

import type { RobotsVerdictStatus } from './robotsParser';

export const BASE_BACKOFF_MS = 5 * 60_000; // 5 minutes
export const CEILING_BACKOFF_MS = 24 * 60 * 60_000; // 24 hours
export const DEFAULT_MAX_REQUESTS_PER_HOUR = 30;
export const ONE_HOUR_MS = 60 * 60_000;
export const STATUS_429_MIN_BACKOFF_MS = 15 * 60_000; // 15 minutes
export const STATUS_403_MIN_BACKOFF_MS = 30 * 60_000; // 30 minutes
export const MAX_ADAPTATION_MULTIPLIER = 4.0;

export interface SourceScheduleState {
  readonly sourceId: string;
  readonly consecutiveFailures: number;
  readonly lastAttemptAtMs: number | null;
  readonly lastSuccessAtMs: number | null;
  readonly lastStatusCode: number | null;
  readonly retryAfterUntilMs: number | null;
  readonly hourlyRequestTimestamps: readonly number[];
  readonly consecutiveUnchangedCount: number;
  readonly crawlDelaySeconds: number | null;
  readonly robotsVerdict: RobotsVerdictStatus;
}

export interface SourceDueVerdict {
  readonly due: boolean;
  readonly reason: string;
  readonly nextAvailableAtMs?: number;
}

export interface AttemptOutcome {
  readonly success: boolean;
  readonly statusCode?: number;
  readonly retryAfterHeader?: string | null;
  readonly newItemsCount?: number;
  readonly nowMs?: number;
}

export interface PoliteSchedulerConfig {
  readonly baseBackoffMs?: number;
  readonly ceilingBackoffMs?: number;
  readonly defaultMaxRequestsPerHour?: number;
  readonly maxAdaptationMultiplier?: number;
}

export interface SourceScheduleInfo {
  readonly sourceId: string;
  readonly consecutiveFailures: number;
  readonly consecutiveUnchangedCount: number;
  readonly adaptedIntervalMinutes: number;
  readonly crawlDelaySeconds: number | null;
  readonly robotsVerdict: RobotsVerdictStatus;
  readonly retryAfterRemainingSec: number | null;
  readonly backoffRemainingSec: number | null;
  readonly hourlyRequestsCount: number;
  readonly maxRequestsPerHour: number;
  readonly isDue: boolean;
  readonly scheduleReason: string;
  readonly nextAvailableAtMs: number | null;
}

export function parseRetryAfterHeader(
  header: string | undefined | null,
  nowMs: number,
): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;

  const seconds = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return nowMs + seconds * 1000;
  }

  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate) && parsedDate >= 0) {
    return parsedDate;
  }

  return null;
}

export function calculateExponentialBackoffMs(
  consecutiveFailures: number,
  statusCode?: number,
  config?: { baseBackoffMs?: number; ceilingBackoffMs?: number },
): number {
  if (consecutiveFailures <= 0) return 0;
  const base = config?.baseBackoffMs ?? BASE_BACKOFF_MS;
  const ceiling = config?.ceilingBackoffMs ?? CEILING_BACKOFF_MS;

  const expBackoff = Math.min(ceiling, base * Math.pow(2, consecutiveFailures - 1));

  if (statusCode === 429) {
    return Math.min(ceiling, Math.max(expBackoff, STATUS_429_MIN_BACKOFF_MS));
  }
  if (statusCode === 403) {
    return Math.min(ceiling, Math.max(expBackoff, STATUS_403_MIN_BACKOFF_MS));
  }

  return expBackoff;
}

export function calculateAdaptedIntervalMinutes(
  baseIntervalMinutes: number,
  consecutiveUnchangedCount: number,
  maxMultiplier: number = MAX_ADAPTATION_MULTIPLIER,
): number {
  if (baseIntervalMinutes <= 0) return 0;
  let multiplier = 1.0;

  if (consecutiveUnchangedCount >= 6) {
    multiplier = 4.0;
  } else if (consecutiveUnchangedCount >= 4) {
    multiplier = 2.0;
  } else if (consecutiveUnchangedCount >= 2) {
    multiplier = 1.5;
  }

  const effectiveMultiplier = Math.min(multiplier, maxMultiplier);
  return Math.round(baseIntervalMinutes * effectiveMultiplier);
}

function filterRecentTimestamps(timestamps: readonly number[], nowMs: number): number[] {
  const windowStart = nowMs - ONE_HOUR_MS;
  return timestamps.filter((t) => t > windowStart);
}

function emptyScheduleState(sourceId: string): SourceScheduleState {
  return {
    sourceId,
    consecutiveFailures: 0,
    lastAttemptAtMs: null,
    lastSuccessAtMs: null,
    lastStatusCode: null,
    retryAfterUntilMs: null,
    hourlyRequestTimestamps: [],
    consecutiveUnchangedCount: 0,
    crawlDelaySeconds: null,
    robotsVerdict: 'allowed',
  };
}

export class PoliteScheduler {
  private readonly states: Map<string, SourceScheduleState> = new Map();
  private readonly config: Required<PoliteSchedulerConfig>;

  constructor(config?: PoliteSchedulerConfig) {
    this.config = {
      baseBackoffMs: config?.baseBackoffMs ?? BASE_BACKOFF_MS,
      ceilingBackoffMs: config?.ceilingBackoffMs ?? CEILING_BACKOFF_MS,
      defaultMaxRequestsPerHour: config?.defaultMaxRequestsPerHour ?? DEFAULT_MAX_REQUESTS_PER_HOUR,
      maxAdaptationMultiplier: config?.maxAdaptationMultiplier ?? MAX_ADAPTATION_MULTIPLIER,
    };
  }

  private getState(sourceId: string): SourceScheduleState {
    const existing = this.states.get(sourceId);
    if (existing) return existing;
    const initial = emptyScheduleState(sourceId);
    this.states.set(sourceId, initial);
    return initial;
  }

  public setRobotsPolicy(
    sourceId: string,
    policy: { verdict: RobotsVerdictStatus; crawlDelaySeconds?: number | null },
  ): void {
    const prev = this.getState(sourceId);
    this.states.set(sourceId, {
      ...prev,
      robotsVerdict: policy.verdict,
      crawlDelaySeconds: policy.crawlDelaySeconds ?? prev.crawlDelaySeconds,
    });
  }

  public recordAttempt(sourceId: string, outcome: AttemptOutcome): void {
    const prev = this.getState(sourceId);
    const nowMs = outcome.nowMs ?? Date.now();
    const updatedHourly = [...filterRecentTimestamps(prev.hourlyRequestTimestamps, nowMs), nowMs];

    if (outcome.success) {
      const newItems = outcome.newItemsCount ?? 0;
      const consecutiveUnchanged = newItems > 0 ? 0 : prev.consecutiveUnchangedCount + 1;
      this.states.set(sourceId, {
        ...prev,
        consecutiveFailures: 0,
        lastAttemptAtMs: nowMs,
        lastSuccessAtMs: nowMs,
        lastStatusCode: outcome.statusCode ?? 200,
        retryAfterUntilMs: null,
        hourlyRequestTimestamps: updatedHourly,
        consecutiveUnchangedCount: consecutiveUnchanged,
      });
    } else {
      const retryAfterUntil = outcome.retryAfterHeader
        ? parseRetryAfterHeader(outcome.retryAfterHeader, nowMs)
        : null;
      this.states.set(sourceId, {
        ...prev,
        consecutiveFailures: prev.consecutiveFailures + 1,
        lastAttemptAtMs: nowMs,
        lastStatusCode: outcome.statusCode ?? prev.lastStatusCode,
        retryAfterUntilMs: retryAfterUntil ?? prev.retryAfterUntilMs,
        hourlyRequestTimestamps: updatedHourly,
      });
    }
  }

  public isSourceDue(
    sourceId: string,
    baseIntervalMinutes: number,
    nowMs: number = Date.now(),
  ): SourceDueVerdict {
    const state = this.getState(sourceId);

    if (state.robotsVerdict === 'disallowed') {
      return { due: false, reason: 'robots_disallowed' };
    }

    const retryCheck = this.checkRetryAfter(state, nowMs);
    if (!retryCheck.due) return retryCheck;

    const backoffCheck = this.checkBackoff(state, nowMs);
    if (!backoffCheck.due) return backoffCheck;

    const hourlyCheck = this.checkHourlyBudget(state, nowMs);
    if (!hourlyCheck.due) return hourlyCheck;

    const crawlDelayCheck = this.checkCrawlDelay(state, nowMs);
    if (!crawlDelayCheck.due) return crawlDelayCheck;

    return this.checkInterval(state, baseIntervalMinutes, nowMs);
  }

  private checkRetryAfter(state: SourceScheduleState, nowMs: number): SourceDueVerdict {
    if (state.retryAfterUntilMs && nowMs < state.retryAfterUntilMs) {
      const remainingSec = Math.ceil((state.retryAfterUntilMs - nowMs) / 1000);
      return {
        due: false,
        reason: `retry_after_active (${remainingSec}s remaining)`,
        nextAvailableAtMs: state.retryAfterUntilMs,
      };
    }
    return { due: true, reason: 'ok' };
  }

  private checkBackoff(state: SourceScheduleState, nowMs: number): SourceDueVerdict {
    if (state.consecutiveFailures > 0 && state.lastAttemptAtMs !== null) {
      const backoffMs = calculateExponentialBackoffMs(
        state.consecutiveFailures,
        state.lastStatusCode ?? undefined,
        this.config,
      );
      const backoffUntilMs = state.lastAttemptAtMs + backoffMs;
      if (nowMs < backoffUntilMs) {
        const remainingSec = Math.ceil((backoffUntilMs - nowMs) / 1000);
        return {
          due: false,
          reason: `exponential_backoff_active (${remainingSec}s remaining, failures: ${state.consecutiveFailures})`,
          nextAvailableAtMs: backoffUntilMs,
        };
      }
    }
    return { due: true, reason: 'ok' };
  }

  private checkHourlyBudget(state: SourceScheduleState, nowMs: number): SourceDueVerdict {
    const recent = filterRecentTimestamps(state.hourlyRequestTimestamps, nowMs);
    if (recent.length >= this.config.defaultMaxRequestsPerHour) {
      const oldestInWindow = recent[0];
      const nextAvailableAtMs = oldestInWindow + ONE_HOUR_MS + 10;
      return {
        due: false,
        reason: `hourly_budget_exhausted (${recent.length}/${this.config.defaultMaxRequestsPerHour} req/h)`,
        nextAvailableAtMs,
      };
    }
    return { due: true, reason: 'ok' };
  }

  private checkCrawlDelay(state: SourceScheduleState, nowMs: number): SourceDueVerdict {
    if (state.crawlDelaySeconds !== null && state.lastAttemptAtMs !== null) {
      const delayMs = state.crawlDelaySeconds * 1000;
      const delayUntilMs = state.lastAttemptAtMs + delayMs;
      if (nowMs < delayUntilMs) {
        return {
          due: false,
          reason: `crawl_delay_active (${Math.ceil((delayUntilMs - nowMs) / 1000)}s remaining)`,
          nextAvailableAtMs: delayUntilMs,
        };
      }
    }
    return { due: true, reason: 'ok' };
  }

  private checkInterval(
    state: SourceScheduleState,
    baseIntervalMinutes: number,
    nowMs: number,
  ): SourceDueVerdict {
    if (state.consecutiveFailures > 0) {
      return { due: true, reason: 'backoff_elapsed_ready_to_retry' };
    }

    if (state.lastSuccessAtMs === null) {
      return { due: true, reason: 'fresh_source' };
    }

    const adaptedMinutes = calculateAdaptedIntervalMinutes(
      baseIntervalMinutes,
      state.consecutiveUnchangedCount,
      this.config.maxAdaptationMultiplier,
    );
    const intervalMs = adaptedMinutes * 60_000;
    const nextDueMs = state.lastSuccessAtMs + intervalMs;

    if (nowMs < nextDueMs) {
      const remainingSec = Math.ceil((nextDueMs - nowMs) / 1000);
      return {
        due: false,
        reason: `interval_not_elapsed (${remainingSec}s remaining, adapted: ${adaptedMinutes}m)`,
        nextAvailableAtMs: nextDueMs,
      };
    }

    return { due: true, reason: 'interval_elapsed' };
  }

  public getScheduleInfo(
    sourceId: string,
    nowMs: number = Date.now(),
    baseIntervalMinutes: number = 30,
  ): SourceScheduleInfo {
    const state = this.getState(sourceId);
    const verdict = this.isSourceDue(sourceId, baseIntervalMinutes, nowMs);
    const adaptedMinutes = calculateAdaptedIntervalMinutes(
      baseIntervalMinutes,
      state.consecutiveUnchangedCount,
      this.config.maxAdaptationMultiplier,
    );
    const recent = filterRecentTimestamps(state.hourlyRequestTimestamps, nowMs);

    const retryRemaining =
      state.retryAfterUntilMs && state.retryAfterUntilMs > nowMs
        ? Math.ceil((state.retryAfterUntilMs - nowMs) / 1000)
        : null;

    const backoffMs = calculateExponentialBackoffMs(
      state.consecutiveFailures,
      state.lastStatusCode ?? undefined,
      this.config,
    );
    const backoffUntil = (state.lastAttemptAtMs ?? 0) + backoffMs;
    const backoffRemaining =
      state.consecutiveFailures > 0 && backoffUntil > nowMs
        ? Math.ceil((backoffUntil - nowMs) / 1000)
        : null;

    return {
      sourceId,
      consecutiveFailures: state.consecutiveFailures,
      consecutiveUnchangedCount: state.consecutiveUnchangedCount,
      adaptedIntervalMinutes: adaptedMinutes,
      crawlDelaySeconds: state.crawlDelaySeconds,
      robotsVerdict: state.robotsVerdict,
      retryAfterRemainingSec: retryRemaining,
      backoffRemainingSec: backoffRemaining,
      hourlyRequestsCount: recent.length,
      maxRequestsPerHour: this.config.defaultMaxRequestsPerHour,
      isDue: verdict.due,
      scheduleReason: verdict.reason,
      nextAvailableAtMs: verdict.nextAvailableAtMs ?? null,
    };
  }

  public exportState(): Record<string, SourceScheduleState> {
    const result: Record<string, SourceScheduleState> = {};
    for (const [id, state] of this.states.entries()) {
      result[id] = { ...state };
    }
    return result;
  }

  public importState(data: Record<string, SourceScheduleState>): void {
    for (const [id, state] of Object.entries(data)) {
      if (state && typeof state === 'object') {
        this.states.set(id, {
          sourceId: id,
          consecutiveFailures: state.consecutiveFailures ?? 0,
          lastAttemptAtMs: state.lastAttemptAtMs ?? null,
          lastSuccessAtMs: state.lastSuccessAtMs ?? null,
          lastStatusCode: state.lastStatusCode ?? null,
          retryAfterUntilMs: state.retryAfterUntilMs ?? null,
          hourlyRequestTimestamps: Array.isArray(state.hourlyRequestTimestamps)
            ? [...state.hourlyRequestTimestamps]
            : [],
          consecutiveUnchangedCount: state.consecutiveUnchangedCount ?? 0,
          crawlDelaySeconds: state.crawlDelaySeconds ?? null,
          robotsVerdict: state.robotsVerdict ?? 'allowed',
        });
      }
    }
  }
}
