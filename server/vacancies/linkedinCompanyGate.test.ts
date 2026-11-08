import { describe, expect, it } from 'vitest';
import { createLinkedinCompanyGate } from './linkedinCompanyGate';

function clock() {
  let t = 1_000_000;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('linkedinCompanyGate (B622)', () => {
  it('runs tasks one by one with spacing', async () => {
    const c = clock();
    const gate = createLinkedinCompanyGate({ now: c.now, sleep: c.sleep, spacingMs: 1000 });
    const starts: number[] = [];
    await Promise.all([1, 2, 3].map(() => gate.run(async () => starts.push(c.now()))));
    expect(starts[1]! - starts[0]!).toBe(1000);
    expect(starts[2]! - starts[1]!).toBe(1000);
  });

  it('a 429 pauses every following company with a Retry-After', async () => {
    const c = clock();
    const gate = createLinkedinCompanyGate({
      now: c.now,
      sleep: c.sleep,
      spacingMs: 0,
      pauseMs: 60_000,
    });
    const limited = Object.assign(new Error('vacancy_source_unreachable: 429'), {
      statusCode: 429,
    });
    await expect(gate.run(async () => Promise.reject(limited))).rejects.toBe(limited);
    let called = false;
    const err = await gate
      .run(async () => {
        called = true;
      })
      .catch((e: unknown) => e as Error & { statusCode: number; headers: Headers });
    expect(called).toBe(false);
    expect(err).toMatchObject({ statusCode: 429 });
    expect((err as { headers: Headers }).headers.get('retry-after')).toBe('60');
    c.advance(60_000);
    await gate.run(async () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  it('a plain failure does not pause the others', async () => {
    const c = clock();
    const gate = createLinkedinCompanyGate({ now: c.now, sleep: c.sleep, spacingMs: 0 });
    await expect(gate.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(gate.run(async () => 7)).resolves.toBe(7);
  });
});
