import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { createBenchmarkLookup } from '../salaryBenchmarks/benchmarkLookup';
import { importSalarySlices } from '../salaryBenchmarks/salaryImport';
import { monthlyMarketEstimate } from '../../../shared/marketSalaryEstimate';
import { openqareerEstimate } from './openqareerEstimate';

const rates = { date: '2026-11-25', rubPerUnit: { USD: 100, EUR: 100 } };
const now = new Date('2026-11-25T00:00:00.000Z');

/** Вымышленные числа: повторяемый ряд вилок, круглых, как в настоящих обзорах. */
function generated() {
  let seed = 7;
  const next = (limit: number) => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) % limit;
  return Array.from({ length: 3_000 }, (_, index) => {
    const low = (30 + next(40)) * 1_000;
    return {
      id: `row-${index}`,
      sourceKind: 'agency',
      sourceName: `Source ${next(3)}`,
      sourceUrl: 'https://example.com',
      role: `Widget Maker ${next(150)}`,
      functionCode: 'data',
      levelRank: next(5),
      country: ['DE', 'FR', 'US'][next(3)]!,
      region: null,
      city: null,
      low,
      median: null,
      high: low + (1 + next(30)) * 1_000,
      currency: 'USD',
      period: 'year',
      tax: 'gross',
      year: 2026,
      sampleSize: null,
      readOn: '2026-11-25',
    };
  });
}

it('no estimate of the whole set repeats a range of the same role and country', () => {
  const rows = generated();
  const database = new DatabaseSync(':memory:');
  const names = [...new Set(rows.map(({ sourceName }) => sourceName))];
  importSalarySlices(database, {
    sources: names.map((name) => ({ name, kind: 'agency', enabled: true })),
    benchmarks: rows,
  });
  const deps = {
    catalog: { get: () => undefined },
    lookup: createBenchmarkLookup(database),
    earning: () => undefined,
    rates,
    now,
  };
  const key = (low: number, high: number) => `${low}|${high}`;
  const own = new Map<string, Set<string>>();
  for (const row of rows) {
    const name = `${row.role}|${row.country}`;
    const month = monthlyMarketEstimate({ low: row.low, high: row.high, period: 'year' });
    const set = own.get(name) ?? new Set();
    own.set(name, set.add(key(row.low, row.high)).add(key(month.low, month.high)));
  }
  let missing = 0;
  const repeated = rows.filter(({ role: title, functionCode, levelRank, country }) => {
    const query = { title, functionCode, levelRank, country, location: undefined };
    const estimate = openqareerEstimate(query, deps)?.estimate;
    if (!estimate) {
      missing += 1;
      return false;
    }
    const set = own.get(`${title}|${country}`);
    const month = monthlyMarketEstimate({ ...estimate, period: 'year' });
    return set?.has(key(estimate.low, estimate.high)) || set?.has(key(month.low, month.high));
  });
  expect(repeated).toEqual([]);
  expect(missing).toBe(0);
}, 30_000);
