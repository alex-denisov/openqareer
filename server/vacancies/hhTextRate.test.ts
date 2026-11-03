import { describe, expect, it } from 'vitest';
import { HH_TEXT_RATE_DEFAULTS, HhTextRateController, type HhTextRateWindow } from './hhTextRate';

const WINDOW = HH_TEXT_RATE_DEFAULTS.windowMs;

function make(overrides: Partial<typeof HH_TEXT_RATE_DEFAULTS> = {}) {
  let now = 0;
  const windows: HhTextRateWindow[] = [];
  const controller = new HhTextRateController({ now: () => now, ...overrides });
  const feed = (outcome: 'ok' | 'refusal' | 'server_error', count: number) => {
    for (let i = 0; i < count; i += 1) controller.record(outcome);
  };
  const advance = (ms: number) => {
    now += ms;
  };
  return { controller, feed, advance, windows };
}

describe('hh text adaptive rate (03.11)', () => {
  it('starts at the configured start rate', () => {
    const { controller } = make();
    expect(controller.snapshot().ratePerSec).toBe(HH_TEXT_RATE_DEFAULTS.startRatePerSec);
    expect(controller.intervalMs()).toBe(Math.round(1_000 / HH_TEXT_RATE_DEFAULTS.startRatePerSec));
  });

  it('raises the rate after a clean window and never past the ceiling', () => {
    const { controller, feed, advance } = make();
    for (let i = 0; i < 20; i += 1) {
      feed('ok', 50);
      advance(WINDOW);
      controller.snapshot();
    }
    const snap = controller.snapshot();
    expect(snap.ratePerSec).toBe(HH_TEXT_RATE_DEFAULTS.maxRatePerSec);
    expect(snap.peakRatePerSec).toBe(HH_TEXT_RATE_DEFAULTS.maxRatePerSec);
    expect(controller.maxInFlight()).toBeLessThanOrEqual(HH_TEXT_RATE_DEFAULTS.maxInFlight);
  });

  it('does not raise on a window with too few samples', () => {
    const { controller, feed, advance } = make();
    feed('ok', 2);
    advance(WINDOW);
    expect(controller.snapshot().ratePerSec).toBe(HH_TEXT_RATE_DEFAULTS.startRatePerSec);
  });

  it('does not raise when 5xx share is 2 percent or more', () => {
    const { controller, feed, advance } = make();
    feed('ok', 48);
    feed('server_error', 2);
    advance(WINDOW);
    expect(controller.snapshot().ratePerSec).toBe(HH_TEXT_RATE_DEFAULTS.startRatePerSec);
  });

  it('halves the rate at once on a refusal and counts it', () => {
    const { controller, feed, advance } = make();
    for (let i = 0; i < 4; i += 1) {
      feed('ok', 50);
      advance(WINDOW);
      controller.snapshot();
    }
    const before = controller.snapshot().ratePerSec;
    expect(before).toBeGreaterThan(HH_TEXT_RATE_DEFAULTS.startRatePerSec);
    feed('refusal', 1);
    const snap = controller.snapshot();
    expect(snap.ratePerSec).toBe(Math.max(HH_TEXT_RATE_DEFAULTS.minRatePerSec, before / 2));
    expect(snap.refusalsTotal).toBe(1);
    expect(snap.peakRatePerSec).toBe(before);
  });

  it('a window with a refusal does not raise the rate afterwards', () => {
    const { controller, feed, advance } = make();
    feed('refusal', 1);
    feed('ok', 60);
    advance(WINDOW);
    expect(controller.snapshot().ratePerSec).toBe(HH_TEXT_RATE_DEFAULTS.minRatePerSec);
  });

  it('emits one summary per closed window, once', () => {
    const { controller, feed, advance } = make();
    feed('ok', 30);
    expect(controller.takeClosedWindow()).toBeUndefined();
    advance(WINDOW);
    const closed = controller.takeClosedWindow();
    expect(closed).toMatchObject({ requests: 30, refusals: 0, serverErrors: 0 });
    expect(closed?.ratePerSec).toBe(
      HH_TEXT_RATE_DEFAULTS.startRatePerSec + HH_TEXT_RATE_DEFAULTS.stepPerSec,
    );
    expect(controller.takeClosedWindow()).toBeUndefined();
  });

  it('suggests a per-tick portion that keeps up with the rate', () => {
    const { controller } = make();
    expect(controller.portionFor(3_000)).toBeGreaterThanOrEqual(
      HH_TEXT_RATE_DEFAULTS.startRatePerSec * 3,
    );
  });
});

describe('parseRetryAfterMs', () => {
  it('reads seconds and dates, ignores junk and the past', async () => {
    const { parseRetryAfterMs } = await import('./hhSearchTransport');
    expect(parseRetryAfterMs('120')).toBe(120_000);
    expect(
      parseRetryAfterMs(
        'Wed, 21 Oct 2026 07:28:30 GMT',
        Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'),
      ),
    ).toBe(30_000);
    expect(parseRetryAfterMs('soon')).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs('0')).toBeUndefined();
  });
});
