import { describe, expect, it, vi } from 'vitest';
import { createCandidateWindowCache } from './candidateWindowCache';

describe('candidate window cache: a continuing read', () => {
  it('serves the list it started with after the window, and a new read recomputes', () => {
    let clock = 0;
    const cache = createCandidateWindowCache<number>(60_000, () => clock);
    const compute = vi.fn(() => clock);
    expect(cache.read('c1|k', compute)).toBe(0);

    clock = 90_000;
    expect(cache.read('c1|k', compute, { continuing: true })).toBe(0);
    expect(compute).toHaveBeenCalledTimes(1);

    expect(cache.read('c1|k', compute)).toBe(90_000);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('still computes a continuing read whose key changed', () => {
    const cache = createCandidateWindowCache<string>(60_000, () => 0);
    cache.read('c1|old', () => 'old');
    expect(cache.read('c1|new', () => 'new', { continuing: true })).toBe('new');
  });

  it('says ahead of a read whether that read would compute', () => {
    let clock = 0;
    const cache = createCandidateWindowCache<number>(60_000, () => clock);
    expect(cache.holds('c1|k')).toBe(false);
    cache.write('c1|k', 1);
    expect(cache.holds('c1|k')).toBe(true);
    expect(cache.holds('c1|other')).toBe(false);
    clock = 90_000;
    expect(cache.holds('c1|k')).toBe(false);
    expect(cache.holds('c1|k', { continuing: true })).toBe(true);
  });
});
