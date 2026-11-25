import { describe, expect, it } from 'vitest';
import type { SalaryBenchmark } from './salaryBenchmark';
import { worldSalaryEstimate } from './worldSalaryEstimate';

/** Вымышленные числа. */
const row = (
  country: string,
  low: number,
  patch: Partial<SalaryBenchmark> = {},
): SalaryBenchmark => ({
  id: `row-${country}-${low}`,
  sourceKind: 'agency',
  sourceName: 'Agency',
  sourceUrl: 'https://example.com/guide',
  role: 'Head of Data',
  roleAliases: [],
  functionCode: 'data',
  levelRank: 2,
  country,
  region: null,
  city: null,
  low,
  median: null,
  high: low * 1.5,
  currency: 'USD',
  period: 'month',
  tax: 'gross',
  payBase: 'base',
  confidence: 'full',
  year: 2026,
  sampleSize: null,
  readOn: '2026-11-25',
  ...patch,
});
const now = new Date('2026-11-25T12:00:00.000Z');
const query = { functionCode: 'data', levelRank: 2 };
const rates = { date: '2026-11-25', rubPerUnit: { USD: 100, EUR: 110 } };
const world = (rows: readonly SalaryBenchmark[]) => worldSalaryEstimate(rows, query, rates, now);

describe('worldSalaryEstimate', () => {
  const three = [row('DE', 4_000), row('US', 10_000), row('RU', 400_000, { currency: 'RUB' })];

  it('spans the countries in monthly dollars and is low confidence', () => {
    expect(world(three)).toEqual({
      estimate: {
        low: 4_000,
        high: 10_500,
        currency: 'USD',
        period: 'month',
        tax: 'gross',
        computedAt: now.toISOString(),
      },
      precision: 'family-world',
      lowConfidence: true,
    });
  });

  it('a country votes once however many rows it has', () => {
    const many = Array.from({ length: 50 }, (_, index) =>
      row('US', 10_000, { id: `us-row-${index}` }),
    );
    expect(world([...many, ...three])?.estimate).toEqual(world(three)?.estimate);
  });

  it('needs three countries of the same function and level', () => {
    expect(world(three.slice(0, 2))).toBeUndefined();
    expect(world([...three.slice(0, 2), row('FR', 5_000, { levelRank: 0 })])).toBeUndefined();
    expect(world([...three.slice(0, 2), row('FR', 5_000, { period: 'hour' })])).toBeUndefined();
    expect(world([...three.slice(0, 2), row('FR', 5_000, { payBase: 'total' })])).toBeUndefined();
  });

  it('divides a year by twelve and skips a currency without a rate', () => {
    const yearly = row('DE', 48_000, { period: 'year' });
    expect(world([yearly, ...three.slice(1)])?.estimate.low).toBe(4_000);
    expect(world([...three.slice(0, 2), row('JP', 1, { currency: 'JPY' })])).toBeUndefined();
  });
});
