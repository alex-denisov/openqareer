import { describe, expect, it } from 'vitest';
import {
  calculateAdaptedIntervalMinutes,
  calculateExponentialBackoffMs,
  parseRetryAfterHeader,
  PoliteScheduler,
} from './politeScheduler';

describe('politeScheduler', () => {
  const BASE_INTERVAL = 30; // 30 minutes
  const NOW = 1757150000000;

  describe('parseRetryAfterHeader', () => {
    it('parses delta-seconds', () => {
      const until = parseRetryAfterHeader('120', NOW);
      expect(until).toBe(NOW + 120_000);
    });

    it('parses HTTP date string', () => {
      const httpDate = 'Sun, 06 Sep 2026 12:00:00 GMT';
      const expectedMs = Date.parse(httpDate);
      const until = parseRetryAfterHeader(httpDate, NOW);
      expect(until).toBe(expectedMs);
    });

    it('returns null for empty or invalid format', () => {
      expect(parseRetryAfterHeader('', NOW)).toBeNull();
      expect(parseRetryAfterHeader('not-a-number-or-date', NOW)).toBeNull();
    });
  });

  describe('calculateExponentialBackoffMs', () => {
    it('returns 0 for 0 failures', () => {
      expect(calculateExponentialBackoffMs(0)).toBe(0);
    });

    it('calculates exponential backoff with ceiling', () => {
      const b1 = calculateExponentialBackoffMs(1); // 5 min
      const b2 = calculateExponentialBackoffMs(2); // 10 min
      const b3 = calculateExponentialBackoffMs(3); // 20 min
      const b4 = calculateExponentialBackoffMs(4); // 40 min
      const b10 = calculateExponentialBackoffMs(10); // capped at 24h

      expect(b1).toBe(5 * 60_000);
      expect(b2).toBe(10 * 60_000);
      expect(b3).toBe(20 * 60_000);
      expect(b4).toBe(40 * 60_000);
      expect(b10).toBe(24 * 60 * 60_000);
    });

    it('gives higher minimum backoff for 429 and 403', () => {
      const b429 = calculateExponentialBackoffMs(1, 429);
      const b403 = calculateExponentialBackoffMs(1, 403);
      expect(b429).toBeGreaterThanOrEqual(15 * 60_000);
      expect(b403).toBeGreaterThanOrEqual(30 * 60_000);
    });
  });

  describe('calculateAdaptedIntervalMinutes', () => {
    it('relaxes interval as unchanged count grows and caps at 4x', () => {
      expect(calculateAdaptedIntervalMinutes(BASE_INTERVAL, 0)).toBe(30);
      expect(calculateAdaptedIntervalMinutes(BASE_INTERVAL, 1)).toBe(30);
      expect(calculateAdaptedIntervalMinutes(BASE_INTERVAL, 2)).toBe(45); // 1.5x
      expect(calculateAdaptedIntervalMinutes(BASE_INTERVAL, 4)).toBe(60); // 2.0x
      expect(calculateAdaptedIntervalMinutes(BASE_INTERVAL, 6)).toBe(120); // 4.0x
      expect(calculateAdaptedIntervalMinutes(BASE_INTERVAL, 20)).toBe(120); // capped at 4.0x
    });
  });

  describe('PoliteScheduler behavior', () => {
    it('marks a fresh source as due immediately', () => {
      const scheduler = new PoliteScheduler();
      const status = scheduler.isSourceDue('src-1', BASE_INTERVAL, NOW);
      expect(status.due).toBe(true);
    });

    it('blocks during exponential backoff after failure', () => {
      const scheduler = new PoliteScheduler();
      scheduler.recordAttempt('src-1', { success: false, nowMs: NOW });

      // After 2 minutes (base backoff is 5 min)
      const early = scheduler.isSourceDue('src-1', BASE_INTERVAL, NOW + 2 * 60_000);
      expect(early.due).toBe(false);
      expect(early.reason).toContain('exponential_backoff');

      // After 6 minutes
      const ready = scheduler.isSourceDue('src-1', BASE_INTERVAL, NOW + 6 * 60_000);
      expect(ready.due).toBe(true);
    });

    it('respects Retry-After header from server', () => {
      const scheduler = new PoliteScheduler();
      scheduler.recordAttempt('src-1', {
        success: false,
        statusCode: 429,
        retryAfterHeader: '300', // 5 minutes
        nowMs: NOW,
      });

      // At 4 minutes
      const early = scheduler.isSourceDue('src-1', BASE_INTERVAL, NOW + 4 * 60_000);
      expect(early.due).toBe(false);
      expect(early.reason).toContain('retry_after');

      // At 6 minutes
      const after = scheduler.isSourceDue('src-1', BASE_INTERVAL, NOW + 6 * 60_000);
      // Interval after retry-after must also be satisfied (base interval 30m vs backoff)
      expect(after.nextAvailableAtMs).toBeDefined();
    });

    it('enforces hourly request budget', () => {
      const scheduler = new PoliteScheduler({ defaultMaxRequestsPerHour: 3 });
      scheduler.recordAttempt('src-1', { success: true, newItemsCount: 1, nowMs: NOW });
      scheduler.recordAttempt('src-1', { success: true, newItemsCount: 1, nowMs: NOW + 10_000 });
      scheduler.recordAttempt('src-1', { success: true, newItemsCount: 1, nowMs: NOW + 20_000 });

      // 4th request within the same hour
      const blocked = scheduler.isSourceDue('src-1', 0, NOW + 30_000);
      expect(blocked.due).toBe(false);
      expect(blocked.reason).toContain('hourly_budget_exhausted');

      // 1 hour and 1 second after 1st request
      const unblocked = scheduler.isSourceDue('src-1', 0, NOW + 3600_000 + 1000);
      expect(unblocked.due).toBe(true);
    });

    it('respects robots crawl-delay', () => {
      const scheduler = new PoliteScheduler();
      scheduler.setRobotsPolicy('src-1', { verdict: 'allowed', crawlDelaySeconds: 10 });
      scheduler.recordAttempt('src-1', { success: true, newItemsCount: 1, nowMs: NOW });

      // 5 seconds later (crawl delay is 10s)
      const tooFast = scheduler.isSourceDue('src-1', 0, NOW + 5000);
      expect(tooFast.due).toBe(false);
      expect(tooFast.reason).toContain('crawl_delay');

      // 11 seconds later
      const allowed = scheduler.isSourceDue('src-1', 0, NOW + 11_000);
      expect(allowed.due).toBe(true);
    });

    it('blocks sources disallowed by robots.txt', () => {
      const scheduler = new PoliteScheduler();
      scheduler.setRobotsPolicy('src-1', { verdict: 'disallowed' });

      const status = scheduler.isSourceDue('src-1', BASE_INTERVAL, NOW);
      expect(status.due).toBe(false);
      expect(status.reason).toBe('robots_disallowed');
    });

    it('adapts interval when feed is unchanged and resets on new items', () => {
      const scheduler = new PoliteScheduler();
      // First sync with items
      scheduler.recordAttempt('src-1', { success: true, newItemsCount: 5, nowMs: NOW });
      expect(scheduler.getScheduleInfo('src-1', NOW).adaptedIntervalMinutes).toBe(30);

      // Multiple syncs with 0 new items
      scheduler.recordAttempt('src-1', {
        success: true,
        newItemsCount: 0,
        nowMs: NOW + 30 * 60_000,
      });
      scheduler.recordAttempt('src-1', {
        success: true,
        newItemsCount: 0,
        nowMs: NOW + 60 * 60_000,
      });
      // Now unchanged count is 2 -> adapted interval = 45 min
      expect(scheduler.getScheduleInfo('src-1', NOW + 60 * 60_000).adaptedIntervalMinutes).toBe(45);

      // Now 30 minutes later, not due yet because adapted interval is 45 min!
      const notYet = scheduler.isSourceDue('src-1', BASE_INTERVAL, NOW + 90 * 60_000);
      expect(notYet.due).toBe(false);
      expect(notYet.reason).toContain('interval_not_elapsed');

      // At 46 minutes later, due
      const nowDue = scheduler.isSourceDue('src-1', BASE_INTERVAL, NOW + 106 * 60_000);
      expect(nowDue.due).toBe(true);

      // Successful sync with new items resets back to 30 min!
      scheduler.recordAttempt('src-1', {
        success: true,
        newItemsCount: 3,
        nowMs: NOW + 106 * 60_000,
      });
      expect(scheduler.getScheduleInfo('src-1', NOW + 106 * 60_000).adaptedIntervalMinutes).toBe(
        30,
      );
    });

    it('exports and imports state faithfully across restarts', () => {
      const scheduler1 = new PoliteScheduler();
      scheduler1.recordAttempt('src-1', { success: false, statusCode: 429, nowMs: NOW });
      scheduler1.setRobotsPolicy('src-1', { verdict: 'allowed', crawlDelaySeconds: 7 });

      const exported = scheduler1.exportState();

      const scheduler2 = new PoliteScheduler();
      scheduler2.importState(exported);

      const info = scheduler2.getScheduleInfo('src-1', NOW);
      expect(info.consecutiveFailures).toBe(1);
      expect(info.crawlDelaySeconds).toBe(7);
      expect(info.robotsVerdict).toBe('allowed');
    });
  });
});
