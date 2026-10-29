import { describe, expect, it, vi } from 'vitest';
import {
  createSelectionFitSweep,
  FREE_SELECTION_FIT_LIMIT,
  selectionFitLimit,
  selectionToCount,
} from './fitSelectionSweep';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';

const row = (id: string, state?: string, percent?: number) =>
  ({
    cluster: { id },
    explanation: state
      ? {
          fitView: {
            state,
            requirements: [],
            ...(percent === undefined
              ? {}
              : {
                  result: {
                    status: 'assessed',
                    dataState: 'confirmed',
                    coveragePercent: percent,
                    coverage: { matched: 0, total: 9, unknown: 0 },
                  },
                }),
          },
        }
      : {},
  }) as unknown as MatchedVacancyItem;

describe('whole-selection fit sweep (CPO 28.10 evening)', () => {
  it('takes every row still counting, in the selection order, and skips counted or final ones', () => {
    const items = [
      row('a', 'ready', 80),
      row('b'),
      row('c', 'no_description'),
      row('d', 'processing'),
      row('e', 'ready', 10),
      row('f', 'not_requested'),
    ];
    expect(selectionToCount(items)).toEqual(['b', 'd', 'f']);
  });

  it('reads text then queues the fit chunk by chunk, once per candidate per window', async () => {
    const preload = vi.fn(async () => undefined);
    const requestFit = vi.fn();
    let now = 0;
    const sweep = createSelectionFitSweep({ chunk: 2, windowMs: 1_000, now: () => now });
    const ids = ['cluster-x1', 'cluster-x2', 'cluster-x3'];
    await sweep('cand', ids, preload, requestFit);
    expect(preload.mock.calls).toEqual([[['x1', 'x2']], [['x3']]]);
    expect(requestFit.mock.calls).toEqual([
      [['cluster-x1', 'cluster-x2'], 0],
      [['cluster-x3'], 2],
    ]);
    await sweep('cand', ids, preload, requestFit);
    expect(preload).toHaveBeenCalledTimes(2);
    now = 1_001;
    await sweep('cand', ids, preload, requestFit);
    expect(preload).toHaveBeenCalledTimes(4);
  });

  it('a failed text read still queues the chunk and the sweep goes on', async () => {
    const preload = vi.fn(async () => {
      throw new Error('hh down');
    });
    const requestFit = vi.fn();
    const sweep = createSelectionFitSweep({ chunk: 1, windowMs: 1_000, now: () => 0 });
    await sweep('cand', ['cluster-a', 'cluster-b'], preload, requestFit);
    expect(requestFit).toHaveBeenCalledTimes(2);
  });

  it('B580: on Free counts only the first 300 rows by relevance, the rest wait for an opened card', () => {
    const items = Array.from({ length: 450 }, (_, index) =>
      row(`r${index}`, index === 5 ? 'ready' : undefined, index === 5 ? 70 : undefined),
    );
    const ids = selectionToCount(items, selectionFitLimit('free'));

    expect(FREE_SELECTION_FIT_LIMIT).toBe(300);
    expect(ids).toHaveLength(299);
    expect(ids.at(-1)).toBe('r299');
    expect(ids).not.toContain('r5');
    expect(selectionToCount(items, selectionFitLimit('pro'))).toHaveLength(449);
  });
});
