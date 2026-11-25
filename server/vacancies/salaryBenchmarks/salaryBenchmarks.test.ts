import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { blendInputOf, blendSalary } from './blendSalaryBenchmarks';
import { matchSalaryBenchmarks, type BenchmarkQuery } from './pickSalaryBenchmark';
import { salaryBenchmarkSchema, type SalaryBenchmark } from './salaryBenchmark';
import {
  SALARY_BENCHMARKS_FILE,
  loadSalaryBenchmarksFile,
  readSalaryBenchmarks,
  writeSalaryBenchmarks,
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
  year: 2026,
  sampleSize: null,
  readOn: '2026-11-25',
  ...patch,
});
const fileOf = (benchmarks: readonly SalaryBenchmark[], enabled = true) => ({
  sources: [{ name: 'Agency', kind: 'agency', enabled }],
  benchmarks,
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

describe('salary_benchmarks', () => {
  it('replaces the table and keeps it when the file is wrong', () => {
    const database = new DatabaseSync(':memory:');
    expect(readSalaryBenchmarks(database, { country: 'AE' })).toEqual([]);
    writeSalaryBenchmarks(database, fileOf([row(), row({ id: 'qa-row', country: 'QA' })]));
    expect(readSalaryBenchmarks(database, { country: 'AE', region: 'mena' })).toEqual([row()]);
    expect(() => writeSalaryBenchmarks(database, fileOf([row(), row()]))).toThrow();
    expect(readSalaryBenchmarks(database, { country: 'QA' })).toHaveLength(1);
  });

  it('refuses an unlisted or refused source', () => {
    const database = new DatabaseSync(':memory:');
    for (const bad of [
      [row({ sourceName: 'Other' })],
      [row({ sourceKind: 'gov' })],
      [row({ sourceUrl: 'https://www.glassdoor.co.uk/x' })],
      [row({ sourceUrl: 'https://www.levels.fyi/x' })],
    ]) {
      expect(() => writeSalaryBenchmarks(database, fileOf(bad))).toThrow();
    }
  });

  it('drops thin samples and keeps only the median of an implausible range', () => {
    const database = new DatabaseSync(':memory:');
    const rows = [
      row({ id: 'thin', sampleSize: 14 }),
      row({ id: 'wide', low: 1, high: 20 }),
      row({ id: 'wide-median', low: 1, median: 12, high: 20 }),
      row({ id: 'enough', sampleSize: 15 }),
    ];
    writeSalaryBenchmarks(database, fileOf(rows));
    const stored = readSalaryBenchmarks(database, { country: 'AE' });
    expect(stored.map(({ id, low }) => [id, low])).toEqual([
      ['enough', 10],
      ['wide-median', null],
    ]);
  });

  it('removes a source by one flag', () => {
    const database = new DatabaseSync(':memory:');
    writeSalaryBenchmarks(database, fileOf([row()]));
    expect(writeSalaryBenchmarks(database, fileOf([row()], false))).toBe(0);
    expect(readSalaryBenchmarks(database, { country: 'AE' })).toEqual([]);
  });

  it('loads the file beside the database and stays quiet without it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'benchmarks-'));
    const database = new DatabaseSync(':memory:');
    const log = { info: vi.fn(), error: vi.fn() };
    try {
      const path = join(directory, 'openqareer.db');
      loadSalaryBenchmarksFile(database, path, log);
      expect(log.info).not.toHaveBeenCalled();
      writeFileSync(join(directory, SALARY_BENCHMARKS_FILE), JSON.stringify(fileOf([row()])));
      loadSalaryBenchmarksFile(database, path, log);
      expect(log.info).toHaveBeenCalledWith({ rows: 1 }, 'salary-benchmarks-loaded');
      writeFileSync(join(directory, SALARY_BENCHMARKS_FILE), '{');
      loadSalaryBenchmarksFile(database, path, log);
      expect(log.error).toHaveBeenCalledOnce();
      expect(readSalaryBenchmarks(database, { country: 'AE' })).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
});
