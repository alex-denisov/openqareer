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
  const ranges = [
    '100 000 — 110 000 ₽',
    '110 000 — 130 000 ₽',
    '120 000 — 140 000 ₽',
    '130 000 — 150 000 ₽',
    '140 000 — 160 000 ₽',
  ];

  it('counts salaries and ranges and takes quartiles of range midpoints', () => {
    const stats = salaryStats([...ranges, 'от 60 000 ₽', '30 000 ₽']);
    expect(stats).toMatchObject({ withSalary: 7, withRange: 5, median: 130000, sign: '₽' });
    expect(stats.low).toBe(120000);
    expect(stats.high).toBe(140000);
  });

  it('gives no median for too few ranges', () => {
    expect(salaryStats(ranges.slice(0, 3))).toEqual({ withSalary: 3, withRange: 3 });
  });

  it('ignores ranges in minority currencies when picking the median', () => {
    const stats = salaryStats([...ranges, '1 000 — 2 000 $']);
    expect(stats.sign).toBe('₽');
    expect(stats.withRange).toBe(6);
  });
});

describe('salary sign from a source label', () => {
  it('drops a label whose tail is not a known currency mark', () => {
    expect(parseSalaryLabel('100 000 — 120 000 <img/src=x>')).toBeUndefined();
    expect(parseSalaryLabel('100 000 — 120 000 ₽')?.sign).toBe('₽');
  });
});
