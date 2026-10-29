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
  it('descending keeps the CPO order: 40 %+, counting, below 40 %, uncountable', () => {
    expect(order('desc')).toEqual(['hi', 'mid', 'counting', 'low', 'none']);
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
