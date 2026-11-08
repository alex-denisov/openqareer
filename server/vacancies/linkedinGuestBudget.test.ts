import { describe, expect, it } from 'vitest';
import {
  budgetedFetch,
  createLinkedinGuestBudget,
  LinkedinPaused,
  type LinkedinConsumer,
} from './linkedinGuestBudget';

function clock() {
  let t = 1_000_000;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      await new Promise((r) => setTimeout(r, 0));
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('linkedinGuestBudget (B622)', () => {
  it('keeps the shared gap between any two requests', async () => {
    const c = clock();
    const budget = createLinkedinGuestBudget({ now: c.now, sleep: c.sleep, baseGapMs: 4000 });
    const at: number[] = [];
    await Promise.all(
      (['guest', 'companies', 'resolver'] as const).map((who) =>
        budget.acquire(who).then(() => at.push(c.now())),
      ),
    );
    expect(at[1]! - at[0]!).toBe(4000);
    expect(at[2]! - at[1]!).toBe(4000);
  });

  it('under contention splits slots by share: resolver half, guest below companies', async () => {
    const c = clock();
    const budget = createLinkedinGuestBudget({ now: c.now, sleep: c.sleep, baseGapMs: 1000 });
    const order: LinkedinConsumer[] = [];
    const loop = async (who: LinkedinConsumer) => {
      for (let i = 0; i < 40; i += 1) {
        await budget.acquire(who);
        order.push(who);
      }
    };
    await Promise.race([loop('resolver'), loop('companies'), loop('guest')]);
    const first = order.slice(0, 40);
    const n = (who: LinkedinConsumer) => first.filter((x) => x === who).length;
    expect(n('resolver')).toBeGreaterThanOrEqual(19);
    expect(n('companies')).toBeGreaterThan(n('guest'));
  });

  it('a lone consumer takes every slot (no idle budget)', async () => {
    const c = clock();
    const budget = createLinkedinGuestBudget({ now: c.now, sleep: c.sleep, baseGapMs: 1000 });
    for (let i = 0; i < 5; i += 1) await budget.acquire('guest');
    expect(budget.stats().lastHour.guest).toBe(5);
  });

  it('a 429 pauses everyone, rejects waiters and doubles the gap', async () => {
    const c = clock();
    const budget = createLinkedinGuestBudget({
      now: c.now,
      sleep: c.sleep,
      baseGapMs: 4000,
      pauseMs: 60_000,
    });
    await budget.acquire('companies');
    budget.markRateLimited();
    const err = await budget.acquire('resolver').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LinkedinPaused);
    expect((err as LinkedinPaused).headers.get('retry-after')).toBe('60');
    expect(budget.stats()).toMatchObject({ gapMs: 8000, rateLimitedLastHour: 1 });
    c.advance(60_000);
    await expect(budget.acquire('guest')).resolves.toBeUndefined();
  });

  it('an hour without 429 relaxes the gap back towards the base', async () => {
    const c = clock();
    const budget = createLinkedinGuestBudget({
      now: c.now,
      sleep: c.sleep,
      baseGapMs: 4000,
      pauseMs: 1000,
    });
    budget.markRateLimited();
    c.advance(61 * 60_000);
    await budget.acquire('guest');
    expect(budget.stats().gapMs).toBe(6000);
  });

  it('budgetedFetch marks the budget on a 429 response', async () => {
    const c = clock();
    const budget = createLinkedinGuestBudget({ now: c.now, sleep: c.sleep });
    const fetch429 = (async () => new Response('', { status: 429 })) as unknown as typeof fetch;
    await budgetedFetch(budget, 'companies', fetch429)('https://www.linkedin.com/x');
    expect(budget.isPaused()).toBe(true);
  });
});
