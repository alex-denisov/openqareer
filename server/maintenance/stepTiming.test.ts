import { describe, expect, it } from 'vitest';
import { recordStepStall, takeStepTiming, timedStep } from './stepTiming';

describe('maintenance step timing (B641)', () => {
  it('counts runs, sync and total time, and attributes stalls to running steps', async () => {
    let t = 0;
    const now = () => t;
    takeStepTiming();
    timedStep(
      'sync',
      () => {
        t += 40;
      },
      now,
    )();
    let release: () => void = () => {};
    const pending = timedStep(
      'async',
      () => {
        t += 5;
        return new Promise<void>((r) => {
          release = r;
        });
      },
      now,
    )();
    recordStepStall(1_200);
    t += 100;
    release();
    await pending;
    await Promise.resolve();
    recordStepStall(1_000);
    const snap = takeStepTiming();
    expect(snap.sync).toMatchObject({ runs: 1, syncMs: 40, totalMs: 40, stallMs: 0 });
    expect(snap.async).toMatchObject({ runs: 1, syncMs: 5, totalMs: 105, stallMs: 1_200 });
    expect(snap['no-step']?.stallMs).toBe(1_000);
    expect(takeStepTiming()).toEqual({});
  });
});
