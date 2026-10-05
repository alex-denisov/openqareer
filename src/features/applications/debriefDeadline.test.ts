import { describe, expect, it } from 'vitest';
import {
  calculateDebriefDeadline,
  computeDebriefFollowUpDate,
} from './debriefDeadline';

describe('calculateDebriefDeadline', () => {
  it('calculates deadline by adding business days, skipping weekends', () => {
    // 2026-10-05 is a Monday
    const monday = '2026-10-05T10:00:00.000Z';
    // +3 business days -> Thursday 2026-10-08
    expect(calculateDebriefDeadline(monday, 3)).toBe('2026-10-08');

    // +5 business days -> next Monday 2026-10-12
    expect(calculateDebriefDeadline(monday, 5)).toBe('2026-10-12');
  });

  it('skips weekends starting from a Friday', () => {
    // 2026-10-09 is a Friday
    const friday = '2026-10-09T14:00:00.000Z';
    // +1 business day -> Monday 2026-10-12
    expect(calculateDebriefDeadline(friday, 1)).toBe('2026-10-12');
    // +3 business days -> Wednesday 2026-10-14
    expect(calculateDebriefDeadline(friday, 3)).toBe('2026-10-14');
  });

  it('accepts YYYY-MM-DD string as input base date', () => {
    expect(calculateDebriefDeadline('2026-10-05', 3)).toBe('2026-10-08');
  });

  it('accounts for timezone offset minutes', () => {
    // 23:00 UTC Sunday is Sunday in UTC (offset 0), so +1 business day lands on Monday 2026-10-05.
    // In UTC+3 (offset 180), 23:00 UTC is already Monday 02:00, so +1 business day lands on Tuesday 2026-10-06.
    const sundayNightUtc = '2026-10-04T23:00:00.000Z';
    const resultUtc = calculateDebriefDeadline(sundayNightUtc, 1, 0);
    const resultUtcPlus3 = calculateDebriefDeadline(sundayNightUtc, 1, 180);
    expect(resultUtc).toBe('2026-10-05');
    expect(resultUtcPlus3).toBe('2026-10-06');
  });
});

describe('computeDebriefFollowUpDate', () => {
  const baseDate = '2026-10-05T10:00:00.000Z'; // Monday

  it('computes 3 business days for preset 3_days', () => {
    const date = computeDebriefFollowUpDate({
      baseDate,
      preset: '3_days',
    });
    expect(date).toBe('2026-10-08');
  });

  it('computes 5 business days for preset 5_days', () => {
    const date = computeDebriefFollowUpDate({
      baseDate,
      preset: '5_days',
    });
    expect(date).toBe('2026-10-12');
  });

  it('computes 10 business days for preset 10_days', () => {
    const date = computeDebriefFollowUpDate({
      baseDate,
      preset: '10_days',
    });
    expect(date).toBe('2026-10-19');
  });

  it('uses custom date when preset is custom and customDate is valid', () => {
    const date = computeDebriefFollowUpDate({
      baseDate,
      preset: 'custom',
      customDate: '2026-10-25',
    });
    expect(date).toBe('2026-10-25');
  });

  it('returns null if custom preset has empty date', () => {
    const date = computeDebriefFollowUpDate({
      baseDate,
      preset: 'custom',
      customDate: '',
    });
    expect(date).toBeNull();
  });
});
