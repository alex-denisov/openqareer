// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SalaryMarketPage, salarySnapshotIndexable, salaryRolePath } from './SalaryMarketPage';
import type { SalaryMarketSnapshot } from '../../../shared/salaryMarketSnapshot';
export const TEST_SALARY_SNAPSHOT: SalaryMarketSnapshot = {
  role: 'software-engineer',
  roleLabel: 'Software Engineer',
  updatedAt: '2026-10-23T00:00:00Z',
  windowDays: 90,
  sampleSize: 20,
  source: 'deduplicated_public_catalog',
  skills: [{ name: 'TypeScript', count: 10, frequency: 50 }],
  grades: 'unavailable',
  quarterlyTrend: 'unavailable',
  salary: {
    status: 'available',
    methodology: 'published_range_bounds',
    excluded: {
      missingPeriod: 10,
      missingCurrency: 0,
      openRange: 0,
      invalidRange: 0,
      belowMinimumSample: 0,
    },
    groups: [
      {
        currency: 'EUR',
        period: 'year',
        taxBasis: 'gross',
        sampleSize: 10,
        lower: { p25: 50000, p50: 60000, p75: 70000, p90: 80000 },
        upper: { p25: 70000, p50: 80000, p75: 90000, p90: 100000 },
      },
      {
        currency: 'USD',
        period: 'hour',
        taxBasis: 'unknown',
        sampleSize: 5,
        lower: { p25: 30, p50: 40, p75: 50, p90: 60 },
        upper: { p25: 40, p50: 50, p75: 60, p90: 70 },
      },
    ],
  },
};
describe('public salary evidence page', () => {
  it('shows explicit pay period, separate bounds and skill denominator', () => {
    const html = renderToStaticMarkup(<SalaryMarketPage snapshot={TEST_SALARY_SNAPSHOT} />);
    expect(html).toContain('Software Engineer');
    expect(html).toContain('EUR, в год, до налогов');
    expect(html).toContain('10 из 20');
    expect(html).toContain('href="/salaries/software-engineer?group=1"');
    expect(html).toContain('href="/signup"');
    expect(html).toContain('Сравнить моё резюме с рынком');
    expect(html).toContain('Individual contributor не означает junior');
  });
  it('selects only a supported bucket and names its own sample', () => {
    const html = renderToStaticMarkup(
      <SalaryMarketPage snapshot={TEST_SALARY_SNAPSHOT} selectedGroup={1} />,
    );
    expect(html).toContain('id="salary-distribution-title">USD, в час, налоги не указаны');
    expect(html).toContain('5 вакансий с полной вилкой');
  });
  it('does not invent a barometer without an observation', () => {
    const html = renderToStaticMarkup(<SalaryMarketPage snapshot={null} />);
    expect(html).toContain('Сравнимой зарплатной выборки пока нет');
    expect(html).not.toContain('<dt>P50</dt>');
    expect(salarySnapshotIndexable(null)).toBe(false);
    expect(salaryRolePath('../private')).toBeUndefined();
  });
});
