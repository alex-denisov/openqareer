import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withRequestTimeout } from './requestTimeout';

describe('withRequestTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const neverEnds = (signal: AbortSignal) =>
    new Promise<string>((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason)),
    );

  it('aborts a request that is really slow', async () => {
    const result = withRequestTimeout(1_000, neverEnds);
    const settled = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(1_000);
    await settled;
  });

  it('gives a late-firing timer a grace period instead of failing a request the stalled loop never read', async () => {
    let clock = 0;
    let resolveBody: (value: string) => void = () => undefined;
    const result = withRequestTimeout(
      1_000,
      (signal) =>
        new Promise<string>((resolve, reject) => {
          resolveBody = resolve;
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
      { clock: () => clock, graceMs: 500, lagMs: 200 },
    );
    clock = 5_000; // the loop was blocked: the timer fires 4 s late
    await vi.advanceTimersByTimeAsync(1_000);
    resolveBody('body'); // the response was queued behind the stall
    await expect(result).resolves.toBe('body');
  });

  it('still aborts when the grace period passes too', async () => {
    let clock = 0;
    const result = withRequestTimeout(1_000, neverEnds, { clock: () => clock, graceMs: 500, lagMs: 200 });
    const settled = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    clock = 5_000;
    await vi.advanceTimersByTimeAsync(1_500);
    await settled;
  });
});
