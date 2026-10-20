import { describe, expect, it } from 'vitest';
import { createFitOrderCache } from './fitOrderCache';

describe('fit order cache', () => {
  it('reuses one ordering for every page of the same read within the window', () => {
    let now = 0;
    let computed = 0;
    const cache = createFitOrderCache<number>(60_000, () => now);
    const compute = () => {
      computed += 1;
      return [3, 2, 1];
    };
    expect(cache.read('c1|fit|stamp|3', compute)).toEqual([3, 2, 1]);
    now = 59_000;
    expect(cache.read('c1|fit|stamp|3', compute)).toEqual([3, 2, 1]);
    expect(computed).toBe(1);
  });

  it('recomputes after the window, for another key, and never shares between candidates', () => {
    let now = 0;
    let computed = 0;
    const cache = createFitOrderCache<number>(60_000, () => now);
    const compute = () => [++computed];
    cache.read('c1|fit|a|3', compute);
    expect(cache.read('c2|fit|a|3', compute)).toEqual([2]);
    expect(cache.read('c1|fit|b|3', compute)).toEqual([3]);
    now = 61_000;
    expect(cache.read('c1|fit|b|3', compute)).toEqual([4]);
  });

  it('keeps at most one entry per candidate so memory does not grow with filters', () => {
    const cache = createFitOrderCache<number>(60_000, () => 0);
    cache.read('c1|fit|a|3', () => [1]);
    cache.read('c1|freshness|a|3', () => [2]);
    expect(cache.size()).toBe(1);
  });
});
