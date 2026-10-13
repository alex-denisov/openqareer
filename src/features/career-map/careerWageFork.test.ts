import { describe, expect, it } from 'vitest';
import {
  calculateRoleWageFork,
  formatVacancyCount,
  isMarketSampleStale,
  MIN_WAGE_SAMPLE,
} from './careerWageFork';

describe('careerWageFork (B445 Criterion 1)', () => {
  it('suppresses wage calculation when salary sample is below threshold', () => {
    const result = calculateRoleWageFork({
      sampleSize: 4,
      minSalary: 500000,
      maxSalary: 700000,
    });
    expect(result.isCalculated).toBe(false);
    expect(result.display).toBe('вилка не считается');
    expect(result.sampleSize).toBe(4);
  });

  it('calculates and formats wage fork when sample is at or above threshold', () => {
    const result = calculateRoleWageFork({
      sampleSize: 88,
      minSalary: 600000,
      maxSalary: 780000,
    });
    expect(result.isCalculated).toBe(true);
    expect(result.display).toBe('600–780 тыс. ₽');
    expect(result.minFormatted).toBe('600');
    expect(result.maxFormatted).toBe('780');
    expect(result.sampleSize).toBe(88);
  });

  it('formats single boundary when min or max is not specified', () => {
    const fromOnly = calculateRoleWageFork({
      sampleSize: MIN_WAGE_SAMPLE,
      minSalary: 450000,
    });
    expect(fromOnly.isCalculated).toBe(true);
    expect(fromOnly.display).toBe('от 450 тыс. ₽');

    const toOnly = calculateRoleWageFork({
      sampleSize: MIN_WAGE_SAMPLE,
      maxSalary: 900000,
    });
    expect(toOnly.isCalculated).toBe(true);
    expect(toOnly.display).toBe('до 900 тыс. ₽');
  });

  it('handles missing salaries honestly without guessing', () => {
    const noSalary = calculateRoleWageFork({
      sampleSize: 100,
    });
    expect(noSalary.isCalculated).toBe(false);
    expect(noSalary.display).toBe('вилка не считается');
  });

  it('formats vacancy count properly', () => {
    expect(formatVacancyCount(4)).toBe('4 вакансии');
    expect(formatVacancyCount(88)).toBe('88 вакансий');
    expect(formatVacancyCount(312)).toBe('312 вакансий');
    expect(formatVacancyCount(21)).toBe('21 вакансия');
  });

  it('detects stale market sample (> 14 days)', () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    // 5 days ago -> fresh
    expect(isMarketSampleStale('2026-10-05T12:00:00.000Z', now)).toBe(false);
    // 15 days ago -> stale
    expect(isMarketSampleStale('2026-09-25T12:00:00.000Z', now)).toBe(true);
  });
});
