import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { benchmarkBeatsCatalog, pickSalaryBenchmark } from './pickSalaryBenchmark';
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

describe('pickSalaryBenchmark', () => {
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

  it('takes the catalogue as the portal layer', () => {
    const match = (precision: 'role-country' | 'family-country', patch = {}) => ({
      benchmark: row(patch),
      precision,
    });
    expect(benchmarkBeatsCatalog(match('role-country'), 'city')).toBe(true);
    expect(benchmarkBeatsCatalog(match('family-country'), 'city')).toBe(false);
    expect(benchmarkBeatsCatalog(match('family-country'), 'country')).toBe(true);
    expect(benchmarkBeatsCatalog(match('family-country', { sourceKind: 'gov' }), 'country')).toBe(
      false,
    );
    expect(benchmarkBeatsCatalog(match('family-country'), undefined)).toBe(true);
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

  it('limits a source to 30 figures and refuses an unlisted or refused source', () => {
    const rows = (count: number) =>
      Array.from({ length: count }, (_, index) => row({ id: `row-${index}` }));
    const database = new DatabaseSync(':memory:');
    expect(writeSalaryBenchmarks(database, fileOf(rows(30)))).toBe(30);
    for (const bad of [
      rows(31),
      [row({ sourceName: 'Other' })],
      [row({ sourceKind: 'gov' })],
      [row({ sourceUrl: 'https://www.glassdoor.co.uk/x' })],
      [row({ sourceUrl: 'https://www.levels.fyi/x' })],
    ]) {
      expect(() => writeSalaryBenchmarks(database, fileOf(bad))).toThrow();
    }
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
