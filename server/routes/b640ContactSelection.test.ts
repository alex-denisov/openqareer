import { describe, expect, it } from 'vitest';
import { selectionKeysWithin } from './b640ContactSelection';

describe('B645 a02: the contacts list does not wait for the match recompute', () => {
  it('returns the selection companies when they come in time', async () => {
    const keys = await selectionKeysWithin(Promise.resolve(['Ромашка', 'Альфа']), 50);
    expect(keys.size).toBe(2);
  });

  it('returns an empty selection when the recompute is slow', async () => {
    const slow = new Promise<string[]>((resolve) => setTimeout(() => resolve(['Ромашка']), 500));
    const started = Date.now();
    const keys = await selectionKeysWithin(slow, 30);
    expect(keys.size).toBe(0);
    expect(Date.now() - started).toBeLessThan(300);
  });

  it('returns an empty selection when the recompute is busy (503) or fails', async () => {
    const keys = await selectionKeysWithin(Promise.reject(new Error('vacancy_match_busy')), 50);
    expect(keys.size).toBe(0);
  });
});
