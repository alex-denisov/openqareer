import { describe, expect, it, vi } from 'vitest';
import {
  UNCLUSTERED_CATCH_UP_CHUNK,
  UnclusteredCatchUp,
  type UnclusteredCatchUpResult,
} from './unclusteredCatchUpStep';

/** B763: догон записей без кластера — окнами, без наложения, с покоем после прохода. */
function setup(results: UnclusteredCatchUpResult[]) {
  let clock = 0;
  let stopped = false;
  let release: (() => void) | undefined;
  const calls: Array<number | undefined> = [];
  const step = vi.fn(async (chunk?: number) => {
    calls.push(chunk);
    await new Promise<void>((resolve) => (release = resolve));
    return results.shift() ?? { inspected: 0, clustered: 0, passFinished: true };
  });
  const log = { info: vi.fn(), error: vi.fn() };
  const catchUp = new UnclusteredCatchUp(
    { runUnclusteredCatchUpStep: step },
    log,
    () => clock,
    () => stopped,
  );
  return {
    catchUp,
    log,
    calls,
    tick: (ms: number) => (clock += ms),
    stop: () => (stopped = true),
    finish: async () => {
      release?.();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

describe('UnclusteredCatchUp (B763)', () => {
  it('runs one window at a time and logs what it clustered', async () => {
    const t = setup([{ inspected: 300, clustered: 12, passFinished: false }]);
    const first = t.catchUp.run();
    await t.catchUp.run();
    expect(t.calls).toEqual([UNCLUSTERED_CATCH_UP_CHUNK]);
    await t.finish();
    await first;
    expect(t.log.info).toHaveBeenCalledWith(
      { inspected: 300, clustered: 12, passFinished: false },
      'vacancy-unclustered-catch-up-tick',
    );
  });

  it('rests an hour after a finished pass, then resumes; nothing after stop', async () => {
    const t = setup([
      { inspected: 0, clustered: 0, passFinished: true },
      { inspected: 300, clustered: 0, passFinished: false },
    ]);
    const pass = t.catchUp.run();
    await t.finish();
    await pass;
    await t.catchUp.run();
    expect(t.calls).toHaveLength(1);

    t.tick(60 * 60 * 1_000);
    const resumed = t.catchUp.run();
    await t.finish();
    await resumed;
    expect(t.calls).toHaveLength(2);

    t.stop();
    await t.catchUp.run();
    expect(t.calls).toHaveLength(2);
  });

  it('a failed window is a journal line, not a crash', async () => {
    const log = { info: vi.fn(), error: vi.fn() };
    const failing = () =>
      Promise.reject(Object.assign(new Error('locked'), { name: 'SqliteError' }));
    const catchUp = new UnclusteredCatchUp(
      { runUnclusteredCatchUpStep: failing },
      log,
      () => 0,
      () => false,
    );
    await catchUp.run();
    expect(log.error).toHaveBeenCalledWith(
      { errorName: 'SqliteError' },
      'vacancy-unclustered-catch-up-failed',
    );
  });
});
