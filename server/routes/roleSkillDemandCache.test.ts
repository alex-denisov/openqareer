import { describe, expect, it, vi } from 'vitest';
import { RoleSkillDemandCache } from './roleSkillDemandCache';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('RoleSkillDemandCache', () => {
  it('answers pending at once, computes in the background, then serves the result', async () => {
    const compute = vi.fn(async (roles: readonly string[]) => roles.map((r) => `${r}!`));
    const cache = new RoleSkillDemandCache(compute, { ttlMs: 1_000, now: () => 0 });
    expect(cache.read('c1', ['CTO'])).toEqual({ state: 'pending' });
    expect(cache.read('c1', ['CTO'])).toEqual({ state: 'pending' });
    await flush();
    expect(compute).toHaveBeenCalledTimes(1);
    expect(cache.read('c1', ['CTO'])).toEqual({ state: 'ready', value: ['CTO!'] });
  });

  it('serves a stale result while it refreshes, and recomputes when roles change', async () => {
    let clock = 0;
    let round = 0;
    const compute = vi.fn(async () => [++round]);
    const cache = new RoleSkillDemandCache(compute, { ttlMs: 100, now: () => clock });
    cache.read('c1', ['CTO']);
    await flush();
    clock = 500;
    expect(cache.read('c1', ['CTO'])).toEqual({ state: 'ready', value: [1] });
    await flush();
    expect(cache.read('c1', ['CTO'])).toEqual({ state: 'ready', value: [2] });
    expect(cache.read('c1', ['CTO', 'CIO'])).toEqual({ state: 'pending' });
    await flush();
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it('a failed compute leaves the entry pending and retries on the next read', async () => {
    const compute = vi.fn().mockRejectedValueOnce(new Error('pool')).mockResolvedValue(['ok']);
    const cache = new RoleSkillDemandCache(compute, { ttlMs: 100, now: () => 0 });
    cache.read('c1', ['CTO']);
    await flush();
    expect(cache.read('c1', ['CTO'])).toEqual({ state: 'pending' });
    await flush();
    expect(cache.read('c1', ['CTO'])).toEqual({ state: 'ready', value: ['ok'] });
  });
});
