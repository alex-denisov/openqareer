import { describe, expect, it } from 'vitest';
import { createHostRequestPacer, HostPausedError } from './hostRequestPacer';

describe('Phase 1 F5 — HostRequestPacer', () => {
  it('enforces >= 650ms FIFO spacing for concurrent join.com requests without blocking other hosts', async () => {
    let clock = 1_000;
    const sleepCalls: number[] = [];
    const pacer = createHostRequestPacer({
      now: () => clock,
      sleep: async (ms) => {
        await Promise.resolve();
        sleepCalls.push(ms);
        clock += ms;
      },
    });

    const joinTimestamps: number[] = [];
    const otherTimestamps: number[] = [];

    await Promise.all([
      ...Array.from({ length: 4 }, (_, i) =>
        pacer.acquire(`https://join.com/api/public/companies/${i}/jobs`).then(() => {
          joinTimestamps.push(clock);
        }),
      ),
      pacer.acquire('https://boards-api.greenhouse.io/v1/boards/acme/jobs').then(() => {
        otherTimestamps.push(clock);
      }),
    ]);

    expect(joinTimestamps).toEqual([1_000, 1_650, 2_300, 2_950]);
    expect(otherTimestamps).toEqual([1_000]);
    expect(sleepCalls).toEqual([650, 650, 650]);
  });

  it('pauses sibling requests briefly on short Retry-After and fails fast with HostPausedError on long Retry-After', async () => {
    let clock = 10_000;
    const sleeps: number[] = [];
    const pacer = createHostRequestPacer({
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });

    pacer.recordResponse(
      'https://join.com/api/public/companies/1/jobs',
      429,
      new Headers({ 'retry-after': '2' }),
    );
    expect(pacer.isHostPaused('join.com', clock)).toBe(true);
    expect(pacer.isLongPaused('join.com', clock)).toBe(false);

    await pacer.acquire('https://join.com/api/public/companies/2/jobs');
    expect(sleeps).toContain(2_000);

    pacer.recordResponse(
      'https://join.com/api/public/companies/3/jobs',
      429,
      new Headers({ 'retry-after': '1800' }),
    );
    expect(pacer.isLongPaused('join.com', clock)).toBe(true);
    await expect(pacer.acquire('https://join.com/api/public/companies/4/jobs')).rejects.toBeInstanceOf(
      HostPausedError,
    );
  });

  it('terminates cleanly when tests inject constant now() => 0 and no-op sleep', async () => {
    const pacer = createHostRequestPacer({
      now: () => 0,
      sleep: async () => {},
    });
    await expect(pacer.acquire('https://join.com/api/public/companies/1/jobs')).resolves.toBeUndefined();
    await expect(pacer.acquire('https://join.com/api/public/companies/2/jobs')).resolves.toBeUndefined();
  });
});
