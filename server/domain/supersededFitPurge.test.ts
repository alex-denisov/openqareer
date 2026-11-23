import { describe, expect, it, vi } from 'vitest';
import {
  purgeSupersededPass,
  runSupersededPurge,
  SUPERSEDED_PURGE_EVERY_MS,
  SUPERSEDED_PURGE_PAUSE_MS,
  SUPERSEDED_PURGE_PASS_ROWS,
} from './supersededFitPurge';

function rows(total: number, batchSize = 20) {
  let left = total;
  return () => {
    const taken = Math.min(batchSize, left);
    left -= taken;
    return taken;
  };
}

describe('superseded fit jobs go in paced hourly passes', () => {
  it('a pass stops at its limit and pauses after every batch', async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const removed = await purgeSupersededPass({
      batch: rows(12_000),
      sleep,
      stopping: () => false,
      log: vi.fn(),
      warn: vi.fn(),
    });
    expect(removed).toEqual({ removed: SUPERSEDED_PURGE_PASS_ROWS, failed: false });
    expect(sleep).toHaveBeenCalledTimes(SUPERSEDED_PURGE_PASS_ROWS / 20);
    expect(sleep).toHaveBeenCalledWith(SUPERSEDED_PURGE_PAUSE_MS);
  });

  it('runs hourly while full passes find rows and ends on the first short pass', async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const log = vi.fn();
    await runSupersededPurge({
      batch: rows(12_000),
      sleep,
      stopping: () => false,
      log,
      warn: vi.fn(),
    });
    expect(log.mock.calls.map(([n]) => n)).toEqual([5000, 5000, 2000]);
    expect(sleep.mock.calls.filter(([ms]) => ms === SUPERSEDED_PURGE_EVERY_MS)).toHaveLength(2);
  });

  it('a stop ends the pass between batches and writes nothing more', async () => {
    let stopping = false;
    const batch = vi.fn(rows(12_000));
    const sleep = vi.fn(async (_ms: number) => {
      if (batch.mock.calls.length === 3) stopping = true;
    });
    await runSupersededPurge({
      batch,
      sleep,
      stopping: () => stopping,
      log: vi.fn(),
      warn: vi.fn(),
    });
    expect(batch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.some(([ms]) => ms === SUPERSEDED_PURGE_EVERY_MS)).toBe(false);
  });

  it('nothing to purge: no log, no hourly wait', async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const log = vi.fn();
    await runSupersededPurge({ batch: () => 0, sleep, stopping: () => false, log, warn: vi.fn() });
    expect(log).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('a failed batch does not throw: it is reported and the next hour tries again', async () => {
    const next = rows(100);
    let calls = 0;
    const batch = () => {
      calls += 1;
      if (calls === 2) throw new Error('database is locked');
      return next();
    };
    const sleep = vi.fn(async (_ms: number) => undefined);
    const warn = vi.fn();
    const log = vi.fn();
    await runSupersededPurge({ batch, sleep, stopping: () => false, log, warn });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls.filter(([ms]) => ms === SUPERSEDED_PURGE_EVERY_MS)).toHaveLength(1);
    expect(log.mock.calls.map(([n]) => n)).toEqual([20, 80]);
  });
});
