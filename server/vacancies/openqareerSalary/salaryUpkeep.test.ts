import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import {
  writeSalarySlice,
  createSalaryBenchmarkReader,
} from '../salaryBenchmarks/sqliteSalaryBenchmarkStore';
import { measureCoverage, rebuildBenchmarks, refreshPrices } from './salaryUpkeep';

const codes = Array.from({ length: 101 }, (_, index) =>
  index === 0
    ? 'RU'
    : String.fromCharCode(65 + (index % 26)) + String.fromCharCode(65 + Math.floor(index / 26)),
);
const answer = (percent: number | null, countries = codes) => [
  { pages: 1 },
  countries.flatMap((id) =>
    [2025, 2026].map((year) => ({
      country: { id },
      date: String(year),
      value: year === 2025 ? percent : null,
    })),
  ),
];
const fetchOf = (json: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(json))) as unknown as typeof fetch;

/** Вымышленные числа. */
const row = (patch: Record<string, unknown>) => ({
  id: 'row-one',
  sourceKind: 'agency',
  sourceName: 'Agency',
  sourceUrl: 'https://example.com',
  role: 'Widget Maker',
  functionCode: 'data',
  levelRank: 0,
  country: 'RU',
  region: null,
  city: null,
  low: 1_000,
  median: null,
  high: 2_000,
  currency: 'RUB',
  period: 'month',
  tax: 'gross',
  year: 2024,
  sampleSize: null,
  readOn: '2026-11-25',
  ...patch,
});
const stored = () => {
  const database = new DatabaseSync(':memory:');
  writeSalarySlice(database, {
    source: { name: 'Agency', kind: 'agency', enabled: true },
    sliceDate: '2026-11-25',
    benchmarks: [
      row({}),
      row({ id: 'row-usd', currency: 'USD' }),
      row({ id: 'row-new', year: 2025 }),
    ],
  });
  const read = createSalaryBenchmarkReader(database);
  const lows = () => Object.fromEntries(read({ country: 'RU' }).map(({ id, low }) => [id, low]));
  return { database, lows };
};
const quiet = () => ({ info: vi.fn(), error: vi.fn() });

describe('refreshPrices', () => {
  it('brings an older figure in the money of the country to the last known year, records stay', async () => {
    const { database, lows } = stored();
    expect(await refreshPrices(database, quiet(), fetchOf(answer(10)))).toBe(true);
    expect(lows()['row-one']).toBe(1_000);
    expect(rebuildBenchmarks(database, quiet())).toBe(true);
    expect(lows()).toEqual({ 'row-one': 1_100, 'row-usd': 1_000, 'row-new': 1_000 });
    expect(database.prepare("SELECT low FROM salary_records WHERE id = 'row-one'").get()?.low).toBe(
      1_000,
    );
  });

  it('leaves a figure after a change of money and falling prices', async () => {
    for (const percent of [150, -5, null]) {
      const { database, lows } = stored();
      await refreshPrices(database, quiet(), fetchOf(answer(percent)));
      rebuildBenchmarks(database, quiet());
      expect(lows()['row-one']).toBe(1_000);
    }
  });

  it('a cut answer changes nothing', async () => {
    const { database, lows } = stored();
    const log = quiet();
    expect(await refreshPrices(database, log, fetchOf(answer(10, ['RU'])))).toBe(false);
    expect(log.error).toHaveBeenCalledOnce();
    expect(lows()['row-one']).toBe(1_000);
  });
});

it('counts the vacancies without salary that have an estimate', async () => {
  const { database } = stored();
  database.exec('CREATE TABLE vacancy_clusters (id TEXT, cluster_json TEXT)');
  const insert = database.prepare('INSERT INTO vacancy_clusters VALUES (?, ?)');
  const clusters = [
    { canonicalTitle: 'Widget Maker', canonicalLocation: 'Москва' },
    { canonicalTitle: 'Zzz', canonicalLocation: 'Nowhere at all' },
    { canonicalTitle: 'Paid', canonicalLocation: 'Москва', salary: { from: 5 } },
  ];
  clusters.forEach((cluster, index) => insert.run(String(index), JSON.stringify(cluster)));
  expect(await measureCoverage(database, 3)).toEqual({
    checked: 2,
    covered: 1,
    steps: { direct: 1 },
  });
});
