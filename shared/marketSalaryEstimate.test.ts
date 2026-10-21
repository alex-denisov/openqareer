import { describe, expect, it } from 'vitest';
import {
  MARKET_SALARY_MIN_SAMPLE,
  estimateFromMidpoints,
  formatMarketSalaryRange,
  marketSalaryBasis,
  marketSalaryKey,
  pickMarketSalaryEstimate,
  salaryMidpoint,
} from './marketSalaryEstimate';

describe('salaryMidpoint', () => {
  it('takes the middle of a range and a single bound as is', () => {
    expect(salaryMidpoint({ from: 400_000, to: 600_000 })).toBe(500_000);
    expect(salaryMidpoint({ from: 450_000 })).toBe(450_000);
    expect(salaryMidpoint({ to: 300_000 })).toBe(300_000);
    expect(salaryMidpoint({})).toBeUndefined();
    expect(salaryMidpoint({ from: 0, to: -5 })).toBeUndefined();
  });

  it('drops hourly rates: they would drag a monthly or yearly range to zero', () => {
    expect(salaryMidpoint({ from: 25, to: 40 })).toBeUndefined();
    expect(salaryMidpoint({ from: 900 })).toBeUndefined();
  });
});

describe('estimateFromMidpoints', () => {
  it('returns the interquartile range rounded to 10 thousand', () => {
    const midpoints = [400_000, 450_000, 480_000, 520_000, 560_000, 600_000, 700_000, 410_000];
    const estimate = estimateFromMidpoints(midpoints, 'RUR');
    // sorted: 400 410 450 480 520 560 600 700; p25 = 440, p75 = 570
    expect(estimate).toEqual({ low: 440_000, high: 570_000, currency: 'RUR', sampleSize: 8 });
  });

  it('gives no number below the minimum sample, only its size', () => {
    expect(MARKET_SALARY_MIN_SAMPLE).toBe(5);
    expect(estimateFromMidpoints([500_000, 520_000, 540_000], 'RUR')).toEqual({
      currency: 'RUR',
      sampleSize: 3,
    });
  });

  it('rounds small monthly foreign amounts to a thousand instead of zeroing them', () => {
    const estimate = estimateFromMidpoints([5_000, 5_500, 6_000, 6_500, 7_000], 'EUR');
    expect(estimate).toEqual({ low: 6_000, high: 7_000, currency: 'EUR', sampleSize: 5 });
  });
});

describe('pickMarketSalaryEstimate', () => {
  const city = { low: 480_000, high: 560_000, currency: 'RUR', sampleSize: 41 };
  const region = { low: 400_000, high: 520_000, currency: 'RUR', sampleSize: 300 };
  it('prefers the city and falls back to the region when the city sample is too small', () => {
    expect(pickMarketSalaryEstimate(city, region)).toEqual({ ...city, basis: 'city' });
    expect(pickMarketSalaryEstimate({ currency: 'RUR', sampleSize: 2 }, region)).toEqual({
      ...region,
      basis: 'region',
    });
  });

  it('keeps the larger thin sample when neither level has enough data', () => {
    expect(
      pickMarketSalaryEstimate(
        { currency: 'RUR', sampleSize: 3 },
        { currency: 'RUR', sampleSize: 4 },
      ),
    ).toEqual({ currency: 'RUR', sampleSize: 4, basis: 'region' });
    expect(pickMarketSalaryEstimate(undefined, undefined)).toBeUndefined();
  });
});

describe('marketSalaryKey', () => {
  it('normalises the place and marks an unknown level', () => {
    expect(marketSalaryKey('it-eng', 4, 'city', ' Москва ')).toBe('it-eng|4|city|москва');
    expect(marketSalaryKey('it-eng', null, 'region', 'russia')).toBe('it-eng|-|region|russia');
  });
});

describe('formatting', () => {
  it('formats a rouble estimate like the mockup', () => {
    expect(formatMarketSalaryRange({ low: 480_000, high: 560_000, currency: 'RUR' })).toBe(
      '≈ 480–560 тыс. ₽',
    );
    expect(formatMarketSalaryRange({ low: 150_000, high: 190_000, currency: 'USD' })).toBe(
      '≈ $150–190 тыс.',
    );
  });

  it('names the sample and the cut date in the dative', () => {
    expect(marketSalaryBasis(41, '2026-10-05T03:00:00.000Z')).toBe('по 41 вакансии, 05.10');
    expect(marketSalaryBasis(29, '2026-10-05T03:00:00.000Z')).toBe('по 29 вакансиям, 05.10');
    expect(marketSalaryBasis(3, '2026-10-05T03:00:00.000Z')).toBe('по 3 вакансиям, 05.10');
  });
});
