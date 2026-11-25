import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createBenchmarkLookup } from '../salaryBenchmarks/benchmarkLookup';
import { importSalarySlices } from '../salaryBenchmarks/salaryImport';
import { bundledCities } from '../vacancyCountry/bundledCities';
import { createCities } from '../vacancyCountry/cityCountry';
import { openqareerEstimate, type EstimateDeps, type EstimateQuery } from './openqareerEstimate';
import { estimateResult, estimateView } from './salaryEstimateReader';

/** Вымышленные числа. */
const row = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  sourceKind: 'agency',
  sourceName: 'Secret Agency',
  sourceUrl: 'https://secret.example.com/guide',
  role: 'Chief Widget Officer',
  functionCode: 'data',
  levelRank: 0,
  country: 'DE',
  region: null,
  city: null,
  low: 48_000,
  median: 54_000,
  high: 60_000,
  currency: 'EUR',
  period: 'year',
  tax: 'gross',
  payBase: 'base',
  year: 2026,
  sampleSize: null,
  readOn: '2026-11-25',
  ...patch,
});
const pairs = ['DE', 'FR', 'US'].flatMap((country) => [
  ...[1, 2, 3].map((index) => row(`${country.toLowerCase()}-ic-${index}`, { country })),
  row(`${country.toLowerCase()}-head`, {
    country,
    role: 'Head',
    levelRank: 2,
    low: 96_000,
    median: 108_000,
    high: 120_000,
  }),
]);
const rates = { date: '2026-11-25', rubPerUnit: { USD: 100, EUR: 100 } };
const now = new Date('2026-11-25T00:00:00.000Z');

function deps(patch: Partial<EstimateDeps> = {}): EstimateDeps {
  const database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE currency_rates (code TEXT, rub_per_unit REAL, rate_date TEXT)');
  database.exec("INSERT INTO currency_rates VALUES ('USD', 100, 'd'), ('EUR', 100, 'd')");
  importSalarySlices(database, {
    sources: [{ name: 'Secret Agency', kind: 'agency', enabled: true }],
    benchmarks: pairs,
  });
  return {
    catalog: { get: () => undefined },
    lookup: createBenchmarkLookup(database),
    earning: () => undefined,
    rates,
    now,
    ...patch,
  };
}
const query = (patch: Partial<EstimateQuery> = {}): EstimateQuery => ({
  title: 'Data Analyst',
  functionCode: 'data',
  levelRank: 0,
  location: 'Berlin',
  country: 'DE',
  ...patch,
});

describe('openqareerEstimate', () => {
  it('blends the same function and level of the country', () => {
    const result = openqareerEstimate(query(), deps());
    expect(result).toMatchObject({ step: 'direct', precision: 'family-country' });
    expect(result?.estimate).toMatchObject({ currency: 'EUR', period: 'year' });
  });

  it('the city of the catalog is more precise than the country of a source', () => {
    const catalog = {
      get: (key: string) =>
        key === 'data|0|city|de:berlin'
          ? ({ low: 4_000, high: 5_000, currency: 'EUR', period: 'month', sampleSize: 9 } as const)
          : undefined,
    };
    const result = openqareerEstimate(query(), deps({ catalog }));
    expect(result).toMatchObject({ step: 'direct', precision: 'family-city' });
    expect(result?.estimate).toMatchObject({ low: 3_600, high: 5_500, period: 'month' });
  });

  it('a large sample of adverts stands alone, above any guide', () => {
    const catalog = {
      get: (key: string) =>
        key === 'data|0|country|de'
          ? ({ low: 2_000, high: 3_000, currency: 'EUR', period: 'month', sampleSize: 30 } as const)
          : undefined,
    };
    const result = openqareerEstimate(query(), deps({ catalog }));
    expect(result?.estimate).toMatchObject({ low: 1_800, high: 3_300 });
  });

  it('moves a level inside the country by the measured ratio, two levels at most', () => {
    const lead = openqareerEstimate(query({ levelRank: 3 }), deps());
    expect(lead?.step).not.toBe('level');
    const multipliers = { get: (key: string) => ({ '*|1': 1.5, '*|2': 2 })[key] };
    const lookup = { ...deps().lookup, multipliers };
    expect(openqareerEstimate(query({ levelRank: 1 }), deps({ lookup }))).toMatchObject({
      step: 'level',
      lowConfidence: true,
    });
  });

  it('then the open statistics, then the world, then nothing', () => {
    const earning = () => ({ monthlyUsd: 2_000, year: 2025, basis: 'direct' as const });
    const away = query({ country: 'NG', location: 'Lagos' });
    expect(openqareerEstimate(away, deps({ earning }))?.step).toBe('statistics');
    expect(openqareerEstimate(away, deps())?.step).toBe('world');
    expect(openqareerEstimate(query({ country: undefined }), deps())?.step).toBe('world');
    const unnamed = { functionCode: 'other' };
    expect(openqareerEstimate(query({ country: undefined, ...unnamed }), deps())).toBeUndefined();
    expect(openqareerEstimate(query(unnamed), deps({ earning }))?.step).toBe('statistics');
  });
});

it('the answer carries a month range and no trace of the sources', () => {
  const hint = {
    resolvePlace: () => undefined,
    cities: createCities(bundledCities()),
    employerCountry: () => undefined,
  };
  const result = estimateResult(
    { canonicalTitle: 'Data Analyst', canonicalLocation: 'Friedrichshafen', sources: [] },
    () => ({ functions: ['data'], levelRank: 0 }),
    deps(),
    hint,
  );
  expect(result?.step).toBe('direct');
  const view = estimateView(result!);
  expect(Object.keys(view).sort()).toEqual(
    ['computedAt', 'currency', 'high', 'low', 'period', 'tax'].sort(),
  );
  expect(view).toMatchObject({ period: 'month', tax: 'gross', currency: 'EUR' });
  expect(view.high).toBeLessThan(10_000);
  expect(JSON.stringify(view)).not.toMatch(/secret|agency|http/iu);
});
