import { describe, expect, it } from 'vitest';
import type { CountryPoolPay } from '../../shared/salaryCountryCities';
import { cityPay, countryPay, MIN_CITY_PAY_SAMPLE } from './relocationPay';

const RATES = { date: '2026-11-18', rubPerUnit: { EUR: 100, RSD: 0.85, USD: 90 } };
const READ_AT = '2026-11-18T10:00:00.000Z';

const catalog = (pay?: CountryPoolPay) => ({
  cities: [
    { slug: 'belgrade', label: 'Belgrade', count: 50 },
    { slug: 'novi-sad', label: 'Novi Sad', count: 12 },
  ],
  readAt: READ_AT,
  ...(pay ? { pay } : {}),
});

describe('countryPay', () => {
  it('converts the pool fork into the tax currency per month, with sample, date and source', () => {
    const pay: CountryPoolPay = {
      median: 6_000,
      low: 5_000,
      high: 7_000,
      sign: '€',
      period: 'month',
      sampleSize: 40,
      withSalary: 52,
      readAt: READ_AT,
      sources: ['hh.ru', 'greenhouse.io'],
    };
    expect(countryPay(catalog(pay), 'RSD', RATES)).toEqual({
      state: 'ready',
      currency: 'RSD',
      low: 588_000,
      median: 706_000,
      high: 824_000,
      sampleSize: 40,
      observedAt: READ_AT,
      rateDate: '2026-11-18',
      sources: ['hh.ru', 'greenhouse.io'],
      vacancies: 62,
      city: 'belgrade',
    });
  });

  it('divides a yearly fork by twelve and keeps the currency of the country', () => {
    const pay: CountryPoolPay = {
      median: 120_000,
      low: 96_000,
      high: 144_000,
      sign: '€',
      period: 'year',
      sampleSize: 31,
      withSalary: 31,
      readAt: READ_AT,
      sources: [],
    };
    const result = countryPay(catalog(pay), 'EUR', RATES);
    expect(result).toMatchObject({ state: 'ready', low: 8_000, median: 10_000, high: 12_000 });
    expect(result).toMatchObject({ rateDate: null });
  });

  it('says «мало данных» below the threshold and without a rate', () => {
    expect(countryPay(catalog(), 'RSD', RATES)).toEqual({
      state: 'thin',
      vacancies: 62,
      city: 'belgrade',
    });
    const pay: CountryPoolPay = {
      median: 1,
      low: 1,
      high: 1,
      sign: '₾',
      period: 'month',
      sampleSize: 40,
      withSalary: 40,
      readAt: READ_AT,
      sources: [],
    };
    expect(countryPay(catalog(pay), 'RSD', RATES)).toMatchObject({ state: 'thin' });
    expect(countryPay(null, 'RSD', RATES)).toEqual({ state: 'thin', vacancies: 0, city: null });
  });
});

describe('cityPay', () => {
  const group = (sample: number) => ({
    currency: 'RUB',
    period: 'month' as const,
    sample,
    median: 390_000,
    low: 330_000,
    high: 450_000,
  });
  it('takes the role fork of the city first, then the whole city', () => {
    const role = { withSalary: 20, withRange: 14, groups: [group(14)] };
    const city = { withSalary: 900, withRange: 700, groups: [group(700)] };
    expect(
      cityPay({ stats: role, computedAt: READ_AT }, { stats: city, computedAt: READ_AT }),
    ).toEqual({
      state: 'ready',
      scope: 'role',
      currency: 'RUB',
      low: 330_000,
      median: 390_000,
      high: 450_000,
      sampleSize: 14,
      observedAt: READ_AT,
    });
    const thinRole = { withSalary: 4, withRange: 3, groups: [group(MIN_CITY_PAY_SAMPLE - 1)] };
    expect(
      cityPay({ stats: thinRole, computedAt: READ_AT }, { stats: city, computedAt: READ_AT }),
    ).toMatchObject({
      state: 'ready',
      scope: 'city',
      sampleSize: 700,
    });
  });

  it('is «мало данных» without a monthly ruble group', () => {
    const yearly = {
      withSalary: 30,
      withRange: 30,
      groups: [{ ...group(30), period: 'year' as const }],
    };
    expect(cityPay(null, { stats: yearly, computedAt: READ_AT })).toEqual({ state: 'thin' });
    expect(cityPay(null, null)).toEqual({ state: 'thin' });
  });
});
