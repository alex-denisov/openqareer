import { describe, expect, it } from 'vitest';
import { parseSalaryLabel, salaryStats } from './catalogSalaryStats';

describe('parseSalaryLabel', () => {
  it('reads ranges, open ends, single values and raw currency codes', () => {
    expect(parseSalaryLabel('120 000 — 140 000 ₽')).toEqual({
      from: 120000,
      to: 140000,
      sign: '₽',
    });
    expect(parseSalaryLabel('от 60 000 ₽')).toEqual({ from: 60000, sign: '₽' });
    expect(parseSalaryLabel('до 90 000 RUR')).toEqual({ to: 90000, sign: '₽' });
    expect(parseSalaryLabel('30 000 ₽')).toEqual({ from: 30000, sign: '₽' });
    expect(parseSalaryLabel('договорная')).toBeUndefined();
  });
});

describe('salaryStats', () => {
  const month = (from: number, to: number, currency = 'RUB') =>
    ({ from, to, currency, period: 'month' }) as const;
  const ranges = [
    month(100000, 110000),
    month(110000, 130000),
    month(120000, 140000),
    month(130000, 150000),
    month(140000, 160000),
  ];

  it('takes quartiles of range midpoints per currency and period', () => {
    const stats = salaryStats(7, ranges);
    expect(stats).toMatchObject({ withSalary: 7, withRange: 5 });
    expect(stats.groups).toEqual([
      { currency: 'RUB', period: 'month', sample: 5, median: 130000, low: 120000, high: 140000 },
    ]);
  });

  it('gives no figure for too few ranges', () => {
    expect(salaryStats(3, ranges.slice(0, 3))).toEqual({ withSalary: 3, withRange: 3 });
  });

  it('never mixes yearly, monthly and hourly ranges in one median', () => {
    const year = Array.from({ length: 5 }, (_, i) => ({
      from: 100000 + i * 1000,
      to: 140000 + i * 1000,
      currency: 'USD',
      period: 'year' as const,
    }));
    const hour = Array.from({ length: 4 }, () => ({
      from: 30,
      to: 50,
      currency: 'USD',
      period: 'hour' as const,
    }));
    const stats = salaryStats(20, [...ranges, ...year, ...hour]);
    expect(stats.groups?.map((g) => `${g.currency}|${g.period}|${g.sample}`)).toEqual([
      'RUB|month|5',
      'USD|year|5',
    ]);
    expect(stats.withRange).toBe(14);
  });
});

describe('salary sign from a source label', () => {
  it('drops a label whose tail is not a known currency mark', () => {
    expect(parseSalaryLabel('100 000 — 120 000 <img/src=x>')).toBeUndefined();
    expect(parseSalaryLabel('100 000 — 120 000 ₽')?.sign).toBe('₽');
  });
});
