import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { forkOf } from './DetailRow';

const item = (salary: unknown) =>
  ({
    cluster: { salary },
    explanation: {
      marketSalary: {
        low: 5_000,
        high: 7_500,
        currency: 'EUR',
        period: 'month',
        tax: 'unknown',
        computedAt: '2026-11-25T00:00:00Z',
      },
    },
  }) as unknown as MatchedVacancyItem;
const rates = { date: '2026-11-25', rubPerUnit: { EUR: 98 } };

describe('B803: вилка и оценка в одном периоде', () => {
  it('годовая вилка на шкале месячной оценки стоит месячной', () => {
    const yearly = forkOf(item({ from: 90_000, to: 90_000, currency: 'EUR' }), rates)!;
    expect(yearly).toEqual(
      forkOf(item({ from: 7_500, to: 7_500, currency: 'EUR', period: 'month' }), rates),
    );
    expect(yearly.start).toBeCloseTo(80);
  });

  it('часовая ставка на месячной шкале не рисуется вилкой', () => {
    const market = forkOf(item(undefined), rates);
    expect(forkOf(item({ from: 60, to: 70, currency: 'EUR', period: 'hour' }), rates)).toEqual(
      market,
    );
  });
});
