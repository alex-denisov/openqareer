import { describe, expect, it } from 'vitest';
import { applyOutcome, canRaiseAt, nextAllowedAt, nextAtMoscowClock } from './hhRaiseSchedule';

const now = new Date('2026-11-19T10:00:00.000Z');

describe('nextAllowedAt', () => {
  it('is 4 hours plus a forward-only random offset', () => {
    expect(nextAllowedAt(now, () => 0)).toBe('2026-11-19T14:00:00.000Z');
    expect(Date.parse(nextAllowedAt(now, () => 0.999))).toBeGreaterThan(Date.parse('2026-11-19T14:00:00.000Z'));
    expect(Date.parse(nextAllowedAt(now, () => 0.999))).toBeLessThan(Date.parse('2026-11-19T14:30:00.000Z'));
  });
});

describe('applyOutcome', () => {
  it('ok records the raise and schedules the next one', () => {
    expect(applyOutcome('ok', now, () => 0)).toMatchObject({
      lastResult: 'ok', lastReason: null, lastRaisedAt: now.toISOString(), nextRaiseAt: '2026-11-19T14:00:00.000Z',
    });
  });
  it('captcha pauses auto-raise for 24 hours', () => {
    expect(applyOutcome('captcha', now)).toMatchObject({
      lastResult: 'error', lastReason: 'captcha', pauseReason: 'captcha', pausedUntil: '2026-11-20T10:00:00.000Z',
    });
  });
  it('logged_out pauses until reconnect with no next time', () => {
    expect(applyOutcome('logged_out', now)).toMatchObject({ pauseReason: 'logged_out', pausedUntil: null, nextRaiseAt: null });
  });
  it('too_early shifts to the next permitted time and keeps lastRaisedAt', () => {
    const patch = applyOutcome('too_early', now, () => 0);
    expect(patch).toMatchObject({ lastResult: 'ok', lastReason: 'too_early' });
    expect(patch.nextRaiseAt).toBe('2026-11-19T14:00:00.000Z');
    expect(patch).not.toHaveProperty('lastRaisedAt');
  });
  it('too_early with the hh clock takes the nearest future Moscow time plus a margin', () => {
    const at = new Date('2026-11-24T15:23:00.000Z');
    expect(applyOutcome('too_early', at, () => 0, '20:55').nextRaiseAt).toBe('2026-11-24T17:57:00.000Z');
    expect(nextAtMoscowClock('01:10', at)).toBe('2026-11-24T22:12:00.000Z');
    expect(nextAtMoscowClock('18:22', at)).toBe('2026-11-24T15:24:00.000Z');
    expect(nextAtMoscowClock('18:21', at)).toBe('2026-11-25T15:23:00.000Z');
    expect(nextAtMoscowClock('02:00', new Date('2026-11-24T21:30:00.000Z'))).toBe('2026-11-24T23:02:00.000Z');
  });
  it('foreign_page is an error that does not pause', () => {
    expect(applyOutcome('foreign_page', now)).toMatchObject({ lastResult: 'error', lastReason: 'foreign_page' });
    expect(applyOutcome('foreign_page', now)).not.toHaveProperty('pauseReason');
  });
});

describe('canRaiseAt', () => {
  it('needs 4 hours since the last raise', () => {
    expect(canRaiseAt(null, now)).toBe(true);
    expect(canRaiseAt('2026-11-19T06:00:01.000Z', now)).toBe(false);
    expect(canRaiseAt('2026-11-19T06:00:00.000Z', now)).toBe(true);
  });
});
