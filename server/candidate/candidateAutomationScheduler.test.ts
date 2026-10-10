import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE,
  dailyCandidateAutomationLimit,
  nextCandidateAutomationSendAt,
  randomCandidateAutomationPauseMs,
  validateCandidateAutomationSchedule,
} from './candidateAutomationScheduler';

describe('candidate auto-apply schedule', () => {
  it('uses a bounded random pause from two to nine minutes', () => {
    expect(randomCandidateAutomationPauseMs(() => 0)).toBe(2 * 60_000);
    expect(randomCandidateAutomationPauseMs(() => 0.999)).toBe(9 * 60_000);
  });

  it('moves a due send through lunch quiet hours into the next open window', () => {
    const next = nextCandidateAutomationSendAt(
      new Date('2026-10-12T09:58:00.000Z'),
      'hh',
      DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE,
      () => 0,
    );
    expect(next.toISOString()).toBe('2026-10-12T11:00:00.000Z');
  });

  it('moves sends on weekends to the next weekday channel window', () => {
    const next = nextCandidateAutomationSendAt(
      new Date('2026-10-10T08:00:00.000Z'),
      'hh',
      DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE,
      () => 0,
    );
    expect(next.toISOString()).toBe('2026-10-12T07:00:00.000Z');
  });

  it('keeps the daily limit stable for a candidate and local day within B370 caps', () => {
    const first = dailyCandidateAutomationLimit('candidate-a', '2026-10-12', 'hh');
    expect(dailyCandidateAutomationLimit('candidate-a', '2026-10-12', 'hh')).toBe(first);
    expect(first).toBeGreaterThanOrEqual(12);
    expect(first).toBeLessThanOrEqual(15);
    expect(dailyCandidateAutomationLimit('candidate-a', '2026-10-12', 'linkedin')).toBeLessThanOrEqual(10);
  });

  it('rejects a schedule that would exceed executor limits or widen safety windows', () => {
    expect(validateCandidateAutomationSchedule(DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE)).toEqual({ valid: true });
    expect(validateCandidateAutomationSchedule({
      ...DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE,
      dailyLimits: { hh: 16, linkedin: 10 },
    })).toMatchObject({ valid: false, reason: 'daily_limit_exceeds_executor' });
    expect(validateCandidateAutomationSchedule({
      ...DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE,
      minPauseMinutes: 1,
    })).toMatchObject({ valid: false, reason: 'pause_out_of_range' });
  });
});
