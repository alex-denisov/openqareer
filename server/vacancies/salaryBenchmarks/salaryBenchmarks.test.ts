import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { blendInputOf, blendSalary } from './blendSalaryBenchmarks';
import { matchSalaryBenchmarks, type BenchmarkQuery } from './pickSalaryBenchmark';
import { salaryBenchmarkSchema, type SalaryBenchmark } from './salaryBenchmark';
import { importSalarySlices } from './salaryImport';
import {
  createSalaryBenchmarkReader,
  setSalarySourceEnabled,
  writeSalarySlice,
} from './sqliteSalaryBenchmarkStore';

/** Вымышленные числа: цифры источников в публичный репозиторий не входят. */
const row = (patch: Partial<SalaryBenchmark> = {}): SalaryBenchmark => ({
  id: 'agency-ae-cto',
  sourceKind: 'agency',
  sourceName: 'Agency',
  sourceUrl: 'https://example.com/guide',
  role: 'Chief Technology Officer',
  roleAliases: ['CTO'],
  functionCode: 'eng-mgmt',
  levelRank: 4,
  country: 'AE',
  region: null,
  city: null,
  low: 10,
  median: null,
  high: 20,
  currency: 'AED',
  period: 'month',
  tax: 'unknown',
  payBase: 'unknown',
  confidence: 'full',
  year: 2026,
  sampleSize: null,
  readOn: '2026-11-25',
  ...patch,
});
const dubaiCto = {
  title: 'Chief Technology Officer (CTO)',
  functionCode: 'eng-mgmt',
  levelRank: 4,
  country: 'AE',
  region: 'mena',
  city: 'Dubai',
};

describe('salaryBenchmarkSchema', () => {
  it.each([
    { sourceUrl: 'http://example.com' },
    { country: null },
    { region: 'mena' as const },
    { low: null },
    { low: null, high: null },
    { low: 30 },
    { median: 50 },
    { country: null, region: 'mena' as const, city: 'Dubai' },
    { readOn: '2026-13-40' },
  ])('rejects %j', (patch) => {
    expect(salaryBenchmarkSchema.safeParse({ ...row(), ...patch }).success).toBe(false);
  });
});

const pickSalaryBenchmark = (rows: readonly SalaryBenchmark[], query: BenchmarkQuery) =>
  matchSalaryBenchmarks(rows, query)[0];

describe('matchSalaryBenchmarks', () => {
  it('finds the CTO of the UAE by title and by family', () => {
    expect(pickSalaryBenchmark([row()], dubaiCto)?.precision).toBe('role-country');
    expect(
      pickSalaryBenchmark([row()], { ...dubaiCto, title: 'Chief AI & Technology Officer' })
        ?.precision,
    ).toBe('family-country');
    expect(
      pickSalaryBenchmark([row()], { ...dubaiCto, title: 'Head of Engineering', levelRank: 2 }),
    ).toBeUndefined();
  });

  it('prefers precision to source and source at equal precision', () => {
    const gov = row({ id: 'gov-city', sourceKind: 'gov', city: 'Dubai' });
    const portal = row({ id: 'portal', sourceKind: 'portal', year: 2027 });
    expect(pickSalaryBenchmark([row(), portal, gov], dubaiCto)?.benchmark.id).toBe('gov-city');
    expect(pickSalaryBenchmark([portal, row()], dubaiCto)?.benchmark.id).toBe('agency-ae-cto');
  });

  it('never gives a manager a family average without a level', () => {
    const average = row({ role: 'Managers', roleAliases: [], sourceKind: 'gov', levelRank: null });
    expect(pickSalaryBenchmark([average], dubaiCto)).toBeUndefined();
    expect(
      pickSalaryBenchmark([average], { ...dubaiCto, title: 'Engineer', levelRank: 0 })?.precision,
    ).toBe('family-country');
  });

  it('uses a region only after the country and never another country', () => {
    const region = row({ id: 'region', country: null, region: 'mena' });
    expect(pickSalaryBenchmark([region, row()], dubaiCto)?.benchmark.id).toBe('agency-ae-cto');
    expect(pickSalaryBenchmark([region, row()], { ...dubaiCto, country: 'QA' })?.benchmark.id).toBe(
      'region',
    );
  });

  it('gives every figure of the best step and none of a coarser one', () => {
    const portal = row({ id: 'portal', sourceKind: 'portal' });
    const region = row({ id: 'region', country: null, region: 'mena' });
    expect(
      matchSalaryBenchmarks([region, portal, row()], dubaiCto).map(({ benchmark }) => benchmark.id),
    ).toEqual(['agency-ae-cto', 'portal']);
  });
});

describe('blendSalary', () => {
  const now = new Date('2026-11-25T12:00:00.000Z');
  const input = (patch: Partial<SalaryBenchmark> = {}) =>
    blendInputOf(row({ low: 40_000, high: 60_000, ...patch }))!;
  const blend = (...inputs: ReturnType<typeof input>[]) =>
    blendSalary(inputs, 'role-country', undefined, now);

  it('has no estimate without data', () => {
    expect(blend()).toBeUndefined();
  });

  it('widens a single source and marks it as low confidence', () => {
    expect(blend(input())).toEqual({
      estimate: {
        low: 36_000,
        high: 66_000,
        currency: 'AED',
        period: 'month',
        tax: 'unknown',
        computedAt: now.toISOString(),
      },
      precision: 'role-country',
      lowConfidence: true,
    });
    expect(blend(input(), input())?.lowConfidence).toBe(true);
  });

  it('weights sources by priority and freshness', () => {
    const gov = input({ sourceKind: 'gov', sourceName: 'Gov', low: 20_000, high: 30_000 });
    expect(blend(input(), gov)?.estimate).toMatchObject({ low: 36_000, high: 54_000 });
    const old = input({ sourceName: 'Old', low: 20_000, high: 30_000, year: 2016 });
    expect(blend(input(), old)?.estimate.low).toBe(39_000);
  });

  it('brings a year to a month and never mixes gross with net or currencies without rates', () => {
    const yearly = input({
      sourceName: 'Y',
      low: 480_000,
      high: 720_000,
      period: 'year',
      year: 2025,
    });
    expect(blend(input(), yearly)?.estimate).toMatchObject({ low: 40_000, high: 60_000 });
    const net = input({ sourceName: 'N', tax: 'net', low: 1, high: 2, year: 2025 });
    expect(blend(input({ tax: 'gross' }), net)?.estimate.low).toBe(36_000);
    const usd = input({ sourceName: 'U', currency: 'USD', year: 2025 });
    expect(blend(input(), usd)?.lowConfidence).toBe(true);
  });

  it('gives the outside no source name, link or sample', () => {
    const estimate = blend(input({ sampleSize: 777 }), input({ sourceName: 'B' }))!.estimate;
    expect(Object.keys(estimate).sort()).toEqual([
      'computedAt',
      'currency',
      'high',
      'low',
      'period',
      'tax',
    ]);
  });

  it('keeps an hourly rate out of a salary', () => {
    const hourly = input({ sourceName: 'H', period: 'hour', year: 2025, low: 1, high: 2 });
    expect(blend(input(), hourly)?.lowConfidence).toBe(true);
  });

  it('makes a range of a median alone', () => {
    expect(blend(input({ low: null, high: null, median: 50_000 }))?.estimate).toMatchObject({
      low: 38_000,
      high: 63_000,
    });
  });
});

describe('blendSalary kinds and rounding', () => {
  const blendOf = (...patches: Partial<SalaryBenchmark>[]) =>
    blendSalary(
      patches.map((patch) => blendInputOf(row(patch))!),
      'role-country',
      undefined,
      new Date('2026-11-25T12:00:00.000Z'),
    )!.estimate;
  const at = (sourceName: string, low: number, patch: Partial<SalaryBenchmark>) => ({
    sourceName,
    low,
    high: low * 2,
    ...patch,
  });

  it('an unknown tax does not join gross with net', () => {
    const unknown = at('U', 1_000, {});
    const gross = at('G', 1_000, { tax: 'gross', year: 2025 });
    const net = at('N', 400, { tax: 'net', year: 2024 });
    expect(blendOf(unknown, gross, net)).toMatchObject({
      low: 1_000,
      high: 2_000,
      tax: 'gross',
    });
  });

  it('keeps total pay out of base pay', () => {
    const total = at('T', 4_000, { payBase: 'total' });
    const base = at('B', 1_000, { payBase: 'base', year: 2020 });
    const unknown = at('U', 1_000, { year: 2020 });
    expect(blendOf(total, base, unknown)).toMatchObject({ low: 1_000, high: 2_000 });
  });

  it('a source with many rows votes once and a doubtful one votes half', () => {
    const many = [1, 2, 3, 4].map((index) => at('A', 1_000, { id: `a-${index}-row` }));
    expect(blendOf(...many, at('B', 2_000, {}))).toMatchObject({ low: 1_500, high: 3_000 });
    expect(blendOf(at('A', 1_000, {}), at('B', 2_500, { confidence: 'reduced' }))).toMatchObject({
      low: 1_500,
      high: 3_000,
    });
  });

  it('rounds an hourly and a daily rate by its size', () => {
    expect(blendOf(at('H', 25, { period: 'hour' }))).toMatchObject({ low: 23, high: 55 });
    expect(blendOf(at('D', 450, { period: 'day' }))).toMatchObject({ low: 410, high: 990 });
    expect(blendOf(at('L', 3, { period: 'hour' }))).toMatchObject({ low: 2.7, high: 6.6 });
  });

  it('a single source is never shown as it is', () => {
    for (let low = 1; low < 2_000_000; low = Math.ceil(low * 1.07)) {
      for (const ratio of [1.1, 1.6, 4]) {
        const high = Math.round(low * ratio);
        const shown = blendOf({ low, high });
        expect(shown.low).toBeLessThan(low);
        expect(shown.high).toBeGreaterThan(high);
      }
    }
  });
});

describe('salary store', () => {
  const sliceOf = (
    benchmarks: readonly SalaryBenchmark[],
    sliceDate = '2026-11-25',
    enabled = true,
  ) => ({ source: { name: 'Agency', kind: 'agency', enabled }, sliceDate, benchmarks });
  const opened = () => {
    const database = new DatabaseSync(':memory:');
    return { database, read: createSalaryBenchmarkReader(database) };
  };
  const count = (database: DatabaseSync, table: string) =>
    (database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const other = (patch: Partial<SalaryBenchmark> = {}) =>
    row({ sourceName: 'Portal', sourceKind: 'portal', ...patch });

  it('reads the rows once until a new slice is written', () => {
    const { database, read } = opened();
    expect(read({ country: 'AE' })).toEqual([]);
    writeSalarySlice(database, sliceOf([row()]));
    const first = read({ country: 'AE' })[0];
    expect(first).toEqual(row());
    expect(read({ country: 'AE' })[0]).toBe(first);
    writeSalarySlice(database, sliceOf([row({ low: 11 })], '2026-11-26'));
    expect(read({ country: 'AE' })[0]?.low).toBe(11);
  });

  it('keeps earlier slices and never lets an older one become current', () => {
    const { database, read } = opened();
    writeSalarySlice(database, sliceOf([row({ low: 11 })]));
    writeSalarySlice(database, sliceOf([row({ low: 9 })], '2026-10-01'));
    expect(read({ country: 'AE' })[0]?.low).toBe(11);
    expect(count(database, 'salary_records')).toBe(2);
  });

  it('a corrected slice of the same date is the next version', () => {
    const { database, read } = opened();
    writeSalarySlice(database, sliceOf([row()]));
    writeSalarySlice(database, sliceOf([row({ low: 12 })]));
    expect(read({ country: 'AE' })[0]?.low).toBe(12);
    expect(
      database
        .prepare('SELECT version FROM salary_slices ORDER BY id')
        .all()
        .map((r) => r.version),
    ).toEqual([1, 2]);
  });

  it('a wrong slice changes nothing', () => {
    const { database, read } = opened();
    writeSalarySlice(database, sliceOf([row()]));
    for (const bad of [
      [row(), row()],
      [row({ sourceName: 'Other' })],
      [row({ sourceKind: 'gov' })],
      [row({ sourceUrl: 'https://www.glassdoor.co.uk/x' })],
    ])
      expect(() => writeSalarySlice(database, sliceOf(bad, '2026-11-27'))).toThrow();
    expect(read({ country: 'AE' })).toEqual([row()]);
    expect(count(database, 'salary_slices')).toBe(1);
  });

  it('drops thin samples and keeps only the median of an implausible range', () => {
    const { database, read } = opened();
    writeSalarySlice(
      database,
      sliceOf([
        row({ id: 'thin', sampleSize: 14 }),
        row({ id: 'wide', low: 1, high: 20 }),
        row({ id: 'wide-median', low: 1, median: 12, high: 20 }),
        row({ id: 'enough', sampleSize: 15 }),
      ]),
    );
    expect(read({ country: 'AE' }).map(({ id, low }) => [id, low])).toEqual([
      ['enough', 10],
      ['wide-median', null],
    ]);
    expect(count(database, 'salary_records')).toBe(4);
  });

  it('a switched-off source leaves the answer, keeps its slices and stays off', () => {
    const { database, read } = opened();
    writeSalarySlice(database, sliceOf([row()]));
    setSalarySourceEnabled(database, 'Agency', false);
    expect(read({ country: 'AE' })).toEqual([]);
    writeSalarySlice(database, sliceOf([row({ low: 11 })], '2026-11-26'));
    expect(read({ country: 'AE' })).toEqual([]);
    setSalarySourceEnabled(database, 'Agency', true);
    expect(read({ country: 'AE' })[0]?.low).toBe(11);
    writeSalarySlice(database, sliceOf([row({ low: 11 })], '2026-11-26', false));
    expect(read({ country: 'AE' })).toEqual([]);
    expect(() => setSalarySourceEnabled(database, 'Nobody', true)).toThrow();
  });

  it('imports source by source, twice without duplicates, with one failed source', () => {
    const { database, read } = opened();
    const sources = [
      { name: 'Agency', kind: 'agency', enabled: true },
      { name: 'Portal', kind: 'portal', enabled: true },
    ];
    const good = { sources, benchmarks: [row(), other()] };
    expect(importSalarySlices(database, good).map(({ written }) => written)).toEqual([1, 1]);
    expect(importSalarySlices(database, good).map(({ written }) => written)).toEqual([0, 0]);
    expect(count(database, 'salary_records')).toBe(2);
    const next = { sources, benchmarks: [row({ low: 12 }), other({ low: 30 })] };
    const results = importSalarySlices(database, next);
    expect(results).toEqual([
      { source: 'Agency', written: 1 },
      { source: 'Portal', written: 0, error: 'invalid slice: 1 problems' },
    ]);
    expect(read({ country: 'AE' }).map(({ low }) => low)).toEqual([12, 10]);
    expect(() => importSalarySlices(database, { sources: [], benchmarks: [row()] })).toThrow();
  });
});
