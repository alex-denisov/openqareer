import { describe, expect, it } from 'vitest';
import {
  currentTodayDecision,
  isTodayActionDeferred,
  todayActionDeferralSchema,
  todayDecisionSelectionSchema,
} from './todayDecision';

describe('Today decision lifetime', () => {
  const selection = {
    applicationId: 'synthetic-task',
    resolution: 'accepted' as const,
    updatedAt: '2026-10-16T20:00:00.000Z',
  };
  const deferral = {
    actionId: 'a'.repeat(16),
    deferredThroughDate: '2026-10-17',
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

  it('keeps a deferral through the candidate-local day and releases it at the next midnight', () => {
    expect(isTodayActionDeferred(deferral, new Date('2026-10-16T21:00:00Z'), 'Europe/Moscow')).toBe(
      true,
    );
    expect(isTodayActionDeferred(deferral, new Date('2026-10-17T20:59:59Z'), 'Europe/Moscow')).toBe(
      true,
    );
    expect(isTodayActionDeferred(deferral, new Date('2026-10-17T21:00:00Z'), 'Europe/Moscow')).toBe(
      false,
    );
  });

  it('rejects invalid action identities and calendar dates', () => {
    expect(todayActionDeferralSchema.safeParse(deferral).success).toBe(true);
    expect(todayActionDeferralSchema.safeParse({ ...deferral, actionId: 'bad' }).success).toBe(
      false,
    );
    expect(
      todayActionDeferralSchema.safeParse({ ...deferral, deferredThroughDate: 'tomorrow' }).success,
    ).toBe(false);
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
