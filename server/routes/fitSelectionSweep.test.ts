import { describe, expect, it, vi } from 'vitest';
import {
  createSelectionFitSweep,
  FREE_SELECTION_FIT_LIMIT,
  selectionFitLimit,
  selectionToCount,
  selectionToRead,
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

  it('takes a row showing the previous version percent: only a recount replaces it (prod 9b1d00b4)', () => {
    const items = [row('a', 'ready', 80), row('old', 'refreshing', 100)];
    expect(selectionToCount(items)).toEqual(['old']);
  });

  it('reads text then queues the fit chunk by chunk, once per candidate per window', async () => {
    const preload = vi.fn(async () => undefined);
    const requestFit = vi.fn();
    let now = 0;
    const sweep = createSelectionFitSweep({ chunk: 2, windowMs: 1_000, now: () => now });
    const ids = ['cluster-x1', 'cluster-x2', 'cluster-x3'];
    await sweep('cand', ids, preload, requestFit);
    expect(preload.mock.calls).toEqual([
      [['x1', 'x2'], 0],
      [['x3'], 2],
    ]);
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

  it('01.11: a new selection or profile key restarts at once and stops the older sweep', async () => {
    const preload = vi.fn(async () => undefined);
    const requestFit = vi.fn();
    const sweep = createSelectionFitSweep({ chunk: 1, windowMs: 60_000, now: () => 0 });
    await sweep('cand', ['cluster-a'], preload, requestFit, 'k1');
    await sweep('cand', ['cluster-a'], preload, requestFit, 'k1');
    expect(requestFit).toHaveBeenCalledTimes(1);
    await sweep('cand', ['cluster-a', 'cluster-b'], preload, requestFit, 'k2');
    expect(requestFit).toHaveBeenCalledTimes(3);

    let release: () => void = () => undefined;
    const slow = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const older = sweep('cand', ['cluster-x', 'cluster-y'], slow, requestFit, 'k3');
    await sweep('cand', ['cluster-z'], preload, requestFit, 'k4');
    release();
    await older;
    const queued = requestFit.mock.calls.map(([ids]) => ids[0]);
    expect(queued).toContain('cluster-z');
    expect(queued).not.toContain('cluster-y');
  });
});

describe('hh text for the whole matched list (01.11)', () => {
  it('selectionToRead takes every hh row in list order, counted or not, past the plan limit', () => {
    const items = [
      row('cluster-src-hh-search:1', 'counted', 80),
      row('cluster-src-remotive:2'),
      row('cluster-src-hh-search:3'),
      row('cluster-src-hh-search:4', 'refreshing', 40),
    ];
    expect(selectionToRead(items)).toEqual([
      'cluster-src-hh-search:1',
      'cluster-src-hh-search:3',
      'cluster-src-hh-search:4',
    ]);
  });

  it('queues text for rows outside the count after the counted ones, without a fit request', async () => {
    const preload = vi.fn();
    const requestFit = vi.fn();
    const sweep = createSelectionFitSweep({ chunk: 2 });
    await sweep('cand', ['cluster-a'], preload, requestFit, 'k', [
      'cluster-a',
      'cluster-b',
      'cluster-c',
    ]);
    expect(preload.mock.calls).toEqual([
      [['a'], 0],
      [['b', 'c'], 1],
    ]);
    expect(requestFit.mock.calls).toEqual([[['cluster-a'], 0]]);
  });
});
