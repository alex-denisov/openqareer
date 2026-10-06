import { describe, expect, it } from 'vitest';
import {
  checkActionCapacity,
  classifyLinkedinSafetyStopReason,
  DEFAULT_CANDIDATE_ACTION_LIMITS,
  getCandidateActionPauseMs,
  isAllowedCandidateActionTarget,
  isWithinQuietHours,
} from './candidateActionPolicy';

describe('candidateActionPolicy', () => {
  it('detects quiet hours correctly across timezones', () => {
    // 23:30 Moscow time (20:30 UTC)
    const lateNightMoscow = new Date('2026-09-29T20:30:00.000Z');
    expect(isWithinQuietHours(lateNightMoscow, 'Europe/Moscow')).toBe(true);

    // 14:00 Moscow time (11:00 UTC)
    const afternoonMoscow = new Date('2026-09-29T11:00:00.000Z');
    expect(isWithinQuietHours(afternoonMoscow, 'Europe/Moscow')).toBe(false);

    // 04:00 Moscow time (01:00 UTC)
    const earlyMorningMoscow = new Date('2026-09-29T01:00:00.000Z');
    expect(isWithinQuietHours(earlyMorningMoscow, 'Europe/Moscow')).toBe(true);

    // 08:00 Moscow time (05:00 UTC) -> quiet hours end at 08:00
    const morningStart = new Date('2026-09-29T05:00:00.000Z');
    expect(isWithinQuietHours(morningStart, 'Europe/Moscow')).toBe(false);

    // Same time in America/New_York (EDT, UTC-4):
    // 11:00 UTC is 07:00 EDT (quiet hours!)
    expect(isWithinQuietHours(afternoonMoscow, 'America/New_York')).toBe(true);
  });

  it('enforces daily limits and boost cooldown', () => {
    const daytime = new Date('2026-09-29T12:00:00.000Z');
    const tz = 'Europe/Moscow';

    // 1. Under limits
    const verdict1 = checkActionCapacity('hh_apply', daytime, tz, {
      localDate: '2026-09-29',
      hhAppliesCount: 14,
      linkedinEasyAppliesCount: 0,
      hhBoostsCount: 0,
      lastHhBoostAt: null,
    });
    expect(verdict1.allowed).toBe(true);

    // 2. hh_apply limit reached
    const verdict2 = checkActionCapacity('hh_apply', daytime, tz, {
      localDate: '2026-09-29',
      hhAppliesCount: 15,
      linkedinEasyAppliesCount: 0,
      hhBoostsCount: 0,
      lastHhBoostAt: null,
    });
    expect(verdict2.allowed).toBe(false);
    expect(verdict2.code).toBe('daily_limit_reached');

    // 3. linkedin_easy_apply limit reached
    const verdict3 = checkActionCapacity('linkedin_easy_apply', daytime, tz, {
      localDate: '2026-09-29',
      hhAppliesCount: 0,
      linkedinEasyAppliesCount: 10,
      hhBoostsCount: 0,
      lastHhBoostAt: null,
    });
    expect(verdict3.allowed).toBe(false);
    expect(verdict3.code).toBe('daily_limit_reached');

    // 4. Boost interval: 2 hours ago (less than 4h / 240m)
    const twoHoursAgo = new Date(daytime.getTime() - 120 * 60_000).toISOString();
    const verdict4 = checkActionCapacity('hh_resume_boost', daytime, tz, {
      localDate: '2026-09-29',
      hhAppliesCount: 0,
      linkedinEasyAppliesCount: 0,
      hhBoostsCount: 1,
      lastHhBoostAt: twoHoursAgo,
    });
    expect(verdict4.allowed).toBe(false);
    expect(verdict4.code).toBe('boost_interval_unexpired');

    // 5. Boost interval: 5 hours ago (more than 4h)
    const fiveHoursAgo = new Date(daytime.getTime() - 300 * 60_000).toISOString();
    const verdict5 = checkActionCapacity('hh_resume_boost', daytime, tz, {
      localDate: '2026-09-29',
      hhAppliesCount: 0,
      linkedinEasyAppliesCount: 0,
      hhBoostsCount: 1,
      lastHhBoostAt: fiveHoursAgo,
    });
    expect(verdict5.allowed).toBe(true);
  });

  it('exposes default candidate action limits', () => {
    expect(DEFAULT_CANDIDATE_ACTION_LIMITS.maxHhAppliesPerDay).toBe(15);
    expect(DEFAULT_CANDIDATE_ACTION_LIMITS.maxLinkedinEasyAppliesPerDay).toBe(10);
    expect(DEFAULT_CANDIDATE_ACTION_LIMITS.minHhBoostIntervalMinutes).toBe(240);
  });

  it('allows only HTTPS targets on the platform domains', () => {
    expect(isAllowedCandidateActionTarget('hh', 'https://hh.ru/vacancy/123')).toBe(true);
    expect(isAllowedCandidateActionTarget('hh', 'https://www.hh.ru/vacancy/123')).toBe(true);
    expect(isAllowedCandidateActionTarget('hh', 'https://jobs.hh.ru/vacancy/123')).toBe(false);
    expect(
      isAllowedCandidateActionTarget('linkedin', 'https://www.linkedin.com/jobs/view/123'),
    ).toBe(true);
    expect(isAllowedCandidateActionTarget('hh', 'http://hh.ru/vacancy/123')).toBe(false);
    expect(isAllowedCandidateActionTarget('hh', 'https://not-hh.ru/vacancy/123')).toBe(false);
    expect(
      isAllowedCandidateActionTarget('linkedin', 'https://linkedin.com.evil.test/jobs/view/123'),
    ).toBe(false);
    expect(
      isAllowedCandidateActionTarget('linkedin', 'https://user:pass@linkedin.com/jobs/view/123'),
    ).toBe(false);
    expect(
      isAllowedCandidateActionTarget('linkedin', 'https://linkedin.com:8443/jobs/view/123'),
    ).toBe(false);
  });

  it('chooses randomized inter-action pauses within the policy window', () => {
    expect(getCandidateActionPauseMs(() => 0)).toBe(3_000);
    expect(getCandidateActionPauseMs(() => 0.999999)).toBe(30_000);
  });

  it.each([
    ['checkpoint_required', 'challenge_required'],
    ['http_403', 'platform_restricted'],
    ['rate_limit', 'platform_restricted'],
    ['unexpected_page', 'unexpected_page'],
    ['unclassified provider failure', 'provider_error'],
    [undefined, 'provider_error'],
  ] as const)('classifies LinkedIn failure %s into a safe stop reason', (signal, expected) => {
    expect(classifyLinkedinSafetyStopReason(signal)).toBe(expected);
  });
});
