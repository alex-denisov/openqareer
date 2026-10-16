import { describe, expect, it } from 'vitest';
import { currentTodayDecision, todayDecisionSelectionSchema } from './todayDecision';

describe('Today decision lifetime', () => {
  const selection = {
    applicationId: 'synthetic-task',
    resolution: 'accepted' as const,
    updatedAt: '2026-10-16T20:00:00.000Z',
  };
  it('uses the candidate calendar day rather than UTC midnight', () => {
    expect(currentTodayDecision(selection, new Date('2026-10-16T20:59:00Z'), 'Europe/Moscow')).toBe(
      selection,
    );
    expect(
      currentTodayDecision(selection, new Date('2026-10-16T21:00:00Z'), 'Europe/Moscow'),
    ).toBeUndefined();
  });
  it('has no selection before the candidate chooses and expires old choices', () => {
    expect(currentTodayDecision(undefined)).toBeUndefined();
    expect(currentTodayDecision(selection, new Date('2026-10-18T10:00:00Z'))).toBeUndefined();
  });
  it('rejects unvalidated task IDs, timestamps and resolutions', () => {
    expect(
      todayDecisionSelectionSchema.safeParse({ ...selection, updatedAt: 'unknown' }).success,
    ).toBe(false);
    expect(
      todayDecisionSelectionSchema.safeParse({ ...selection, resolution: 'sent' }).success,
    ).toBe(false);
  });
});
