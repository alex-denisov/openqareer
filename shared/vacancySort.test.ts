import { describe, expect, it } from 'vitest';
import type { VacancyFitView } from './vacancyFit';
import { compareFitDirected, compareMoney, nextVacancySort } from './vacancySort';

const counted = (percent: number): VacancyFitView =>
  ({
    state: 'ready',
    requirements: [],
    result: {
      status: 'assessed',
      dataState: 'partial',
      coveragePercent: percent,
      coverage: { matched: 1, total: 5, unknown: 0 },
    },
  }) as unknown as VacancyFitView;
const counting: VacancyFitView = { state: 'processing', requirements: [] };
const none: VacancyFitView = { state: 'no_description', requirements: [] };
const rows: Record<string, VacancyFitView> = {
  hi: counted(90),
  low: counted(20),
  mid: counted(50),
  counting,
  none,
};
const order = (dir: 'asc' | 'desc') =>
  Object.keys(rows).sort((a, b) => compareFitDirected(rows[a], rows[b], dir));

describe('vacancy sort (owner 29.10)', () => {
  it('flips the active column and starts another one descending', () => {
    expect(nextVacancySort({ by: 'fit', dir: 'desc' }, 'fit')).toEqual({ by: 'fit', dir: 'asc' });
    expect(nextVacancySort({ by: 'fit', dir: 'asc' }, 'money')).toEqual({
      by: 'money',
      dir: 'desc',
    });
  });
  it('descending: counted by percent, counting, uncountable (02.11)', () => {
    expect(order('desc')).toEqual(['hi', 'mid', 'low', 'counting', 'none']);
  });
  it('ascending reverses only the counted rows; uncountable stay last', () => {
    expect(order('asc')).toEqual(['low', 'mid', 'hi', 'counting', 'none']);
  });
  it('puts rows without money last in both directions', () => {
    const money: (number | undefined)[] = [undefined, 300_000, 500_000];
    expect([...money].sort((a, b) => compareMoney(a, b, 'desc'))).toEqual([
      500_000,
      300_000,
      undefined,
    ]);
    expect([...money].sort((a, b) => compareMoney(a, b, 'asc'))).toEqual([
      300_000,
      500_000,
      undefined,
    ]);
  });
});

describe('a contradicted condition ranks the row after unblocked ones (02.11)', () => {
  const blocked = (percent: number): VacancyFitView => {
    const view = counted(percent);
    return {
      ...view,
      result: {
        ...view.result!,
        conditionBlocks: [{ requirementId: 'c', text: 'US only', quote: 'Vilnius' }],
      },
    };
  };
  it('a blocked 100 % sorts after an unblocked 20 % in both directions', () => {
    for (const dir of ['desc', 'asc'] as const) {
      expect(compareFitDirected(blocked(100), counted(20), dir)).toBeGreaterThan(0);
    }
  });
});
