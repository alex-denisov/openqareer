import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { failureMessage, withRequestTimeout } from './requestTimeout';

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
    const result = withRequestTimeout(1_000, neverEnds, {
      clock: () => clock,
      graceMs: 500,
      lagMs: 200,
    });
    const settled = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    clock = 5_000;
    await vi.advanceTimersByTimeAsync(1_500);
    await settled;
  });

  it('keeps waiting while the loop stays blocked, because a second stall proves nothing about the source either', async () => {
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
    clock = 5_000;
    await vi.advanceTimersByTimeAsync(1_000); // first stall ends, grace starts
    clock = 9_000;
    await vi.advanceTimersByTimeAsync(500); // the grace timer fired 3.5 s late
    resolveBody('body');
    await expect(result).resolves.toBe('body');
  });

  it('gives up after the last grace period even if every timer fired late', async () => {
    let clock = 0;
    const result = withRequestTimeout(1_000, neverEnds, {
      clock: () => clock,
      graceMs: 500,
      lagMs: 200,
      maxGraces: 2,
    });
    const settled = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    clock = 5_000;
    await vi.advanceTimersByTimeAsync(1_000);
    clock = 9_000;
    await vi.advanceTimersByTimeAsync(500);
    clock = 13_000;
    await vi.advanceTimersByTimeAsync(500);
    await settled;
  });
});

describe('failureMessage', () => {
  it('names the network cause of a failed fetch', () => {
    const error = new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
    expect(failureMessage(error)).toBe('fetch failed (UND_ERR_CONNECT_TIMEOUT)');
  });

  it('keeps a plain message and a non-error as they are', () => {
    expect(failureMessage(new Error('vacancy_source_unreachable: 404'))).toBe(
      'vacancy_source_unreachable: 404',
    );
    expect(failureMessage('boom')).toBe('boom');
  });
});
