import { describe, expect, it } from 'vitest';
import { buildReviewChecks, type ReviewCheckApplication } from './rejectionReviewChecks';

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.parse('2026-10-02T10:00:00.000Z');

function app(overrides: Partial<ReviewCheckApplication> = {}): ReviewCheckApplication {
  return {
    stage: 'applied',
    appliedAt: new Date(BASE).toISOString(),
    publishedAt: new Date(BASE - DAY).toISOString(),
    salaryTo: null,
    salaryCurrency: null,
    ...overrides,
  };
}

describe('B645: три проверки разбора при малых данных', () => {
  it('считает незавершённые, вилки ниже ожиданий и поздние отклики из отправленных', () => {
    const checks = buildReviewChecks(
      [
        app({ salaryTo: 400_000, salaryCurrency: 'RUR' }),
        app({ stage: 'rejected', salaryTo: 450_000, salaryCurrency: 'RUB' }),
        app({ stage: 'interview', salaryTo: 600_000, salaryCurrency: 'RUB' }),
        app({ stage: 'applied', publishedAt: new Date(BASE - 11 * DAY).toISOString() }),
        app({ stage: 'responded', salaryTo: 300_000, salaryCurrency: 'USD' }),
        app({ stage: 'saved', salaryTo: 100_000, salaryCurrency: 'RUB' }),
      ],
      { amount: 500_000, currency: 'RUB' },
    );
    expect(checks).toEqual({
      since: '2026-10-02T10:00:00.000Z',
      unfinished: { count: 2, total: 5 },
      salaryBelow: { count: 2, total: 5, floor: 500_000, currency: 'RUB' },
      late: { count: 1, total: 5 },
    });
  });

  it('без ожиданий по деньгам проверки вилок нет; без дат — поздних нет', () => {
    const checks = buildReviewChecks([app({ publishedAt: null }), app({ appliedAt: null })], null);
    expect(checks.salaryBelow).toBeNull();
    expect(checks.late).toEqual({ count: 0, total: 2 });
    expect(checks.since).toBe('2026-10-02T10:00:00.000Z');
  });
});
