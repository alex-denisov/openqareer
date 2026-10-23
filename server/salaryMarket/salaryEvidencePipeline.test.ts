import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteVacancyPoolStore } from '../vacancies/sqliteVacancyPoolStore';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { normalizeAtsBoard } from '../vacancies/atsBoardAdapters';
import { clusterProjectionOf } from '../vacancies/vacancyPoolQuery';
import { createClusterFromVacancy } from '../vacancies/vacancyDeduplicator';
import {
  computeSalaryMarketSnapshots,
  writeSalaryMarketSnapshots,
  readSalaryMarketIndex,
} from './salaryMarketSnapshot';

const observedAt = '2026-10-23T00:00:00Z';
function lever(id: string, interval?: string) {
  return normalizeAtsBoard(
    'ats-lever-example',
    [
      {
        id,
        text: 'Frontend Developer',
        categories: { location: 'Berlin' },
        createdAt: Date.parse(observedAt),
        hostedUrl: `https://jobs.lever.co/example/${id}`,
        salaryRange: { min: 90000, max: 120000, currency: 'EUR', interval },
      },
    ],
    { observedAt, sourceName: 'Example' },
  )[0]!;
}

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE catalog_entries (cluster_id TEXT PRIMARY KEY, role_slug TEXT, role_label TEXT, skills_json TEXT, published_ms INTEGER, status TEXT, title TEXT);
    CREATE TABLE vacancy_clusters (id TEXT PRIMARY KEY, cluster_json TEXT)`);
  db.exec(
    'CREATE TRIGGER fixture_title AFTER INSERT ON catalog_entries BEGIN UPDATE catalog_entries SET title = NEW.role_label WHERE cluster_id = NEW.cluster_id; END',
  );
  return db;
}
function store(db: DatabaseSync, id: string, salary: unknown) {
  db.prepare(
    'INSERT INTO catalog_entries (cluster_id, role_slug, role_label, skills_json, published_ms, status) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, 'engineer', 'Engineer', '["SQL"]', Date.parse(observedAt), 'active');
  db.prepare('INSERT INTO vacancy_clusters VALUES (?, ?)').run(id, JSON.stringify({ salary }));
}

describe('explicit salary evidence pipeline', () => {
  it('preserves provider interval and exact provenance through compact input and cluster', () => {
    const vacancy = lever('a', 'per-year-salary');
    const cluster = createClusterFromVacancy(clusterProjectionOf(vacancy));
    expect(cluster.salary).toMatchObject({
      from: 90000,
      to: 120000,
      currency: 'EUR',
      period: 'year',
      periodEvidence: { field: 'lever.salaryRange.interval', value: 'per-year-salary' },
    });
    expect(cluster.salary?.gross).toBeUndefined();
  });
  it('roundtrips provider evidence through real catalog persistence into a canonical B267 profession', () => {
    const directory = mkdtempSync(join(tmpdir(), 'salary-market-pipeline-'));
    const path = join(directory, 'pool.db');
    const store = new SqliteVacancyPoolStore({ databasePath: path });
    const db = new DatabaseSync(path);
    try {
      for (let index = 0; index < 5; index += 1) {
        const vacancy = lever(String(index), 'per-year-salary');
        store.upsertCluster({
          ...createClusterFromVacancy(clusterProjectionOf(vacancy)),
          vacanciesCount: 17,
        });
      }
      const [snapshot] = computeSalaryMarketSnapshots(db, new Date(observedAt));
      expect(snapshot?.role).toBe('frontend-engineer');
      expect(snapshot?.profession).toMatchObject({ kind: 'b267', roleId: 'eng.frontend.ic' });
      expect(snapshot?.sampleSize).toBe(5);
      expect(snapshot?.salary.status).toBe('available');
      writeSalaryMarketSnapshots(db, [snapshot!]);
      expect(readSalaryMarketIndex(db)[0]?.indexable).toBe(true);
      writeSalaryMarketSnapshots(db, [{ ...snapshot!, profession: undefined }]);
      expect(readSalaryMarketIndex(db)[0]?.indexable).toBe(false);
      if (snapshot?.salary.status !== 'available')
        throw new Error('No persisted salary distribution');
      expect(snapshot.salary.groups[0]).toMatchObject({
        period: 'year',
        taxBasis: 'unknown',
        sampleSize: 5,
        lower: { p50: 90000 },
        upper: { p50: 120000 },
      });
    } finally {
      db.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it.each([
    ['per-hour-wage', 'hour'],
    ['per-month-salary', 'month'],
    ['per-year-salary', 'year'],
  ])('maps only documented provider literal %s to %s', (literal, period) => {
    expect(lever('interval', literal).salary?.period).toBe(period);
  });
  it('keeps legacy and unsupported intervals unknown without magnitude inference', () => {
    for (const interval of [undefined, 'one-time', 'semi-month-salary', 'yearly']) {
      expect(lever('a', interval).salary?.period).toBeUndefined();
    }
  });
  it('computes separate lower/upper percentiles in comparable buckets only', () => {
    const db = database();
    for (let index = 0; index < 5; index += 1) {
      const salary = lever(String(index), 'per-year-salary').salary!;
      store(db, `unknown-${index}`, { ...salary, from: 100 + index * 100, to: 200 + index * 100 });
      store(db, `gross-${index}`, { ...salary, from: 1000, to: 2000, gross: true });
      store(db, `net-${index}`, { ...salary, from: 500, to: 1500, gross: false });
      store(db, `month-${index}`, {
        ...salary,
        period: 'month',
        periodEvidence: { field: 'lever.salaryRange.interval', value: 'per-month-salary' },
      });
    }
    const [snapshot] = computeSalaryMarketSnapshots(db, new Date(observedAt));
    expect(snapshot?.salary.status).toBe('available');
    if (snapshot?.salary.status !== 'available') throw new Error('No salary groups');
    expect(snapshot.salary.methodology).toBe('published_range_bounds');
    expect(snapshot.salary.groups).toHaveLength(4);
    expect(
      snapshot.salary.groups.find(
        (group) => group.period === 'year' && group.taxBasis === 'unknown',
      ),
    ).toMatchObject({
      sampleSize: 5,
      lower: { p25: 200, p50: 300, p75: 400, p90: 500 },
      upper: { p25: 300, p50: 400, p75: 500, p90: 600 },
    });
    db.close();
  });
  it('counts subminimum and currency-separated observations without publishing tiny groups', () => {
    const db = database();
    for (let index = 0; index < 4; index += 1) {
      store(db, `eur-${index}`, lever(String(index), 'per-year-salary').salary);
      store(db, `usd-${index}`, {
        ...lever(String(index), 'per-year-salary').salary,
        currency: 'USD',
      });
    }
    const [snapshot] = computeSalaryMarketSnapshots(db, new Date(observedAt));
    expect(snapshot?.salary).toMatchObject({
      status: 'unavailable',
      reason: 'no_comparable_ranges',
      excluded: { belowMinimumSample: 8 },
    });
    db.close();
  });
  it('aggregates canonical professions before the role cap and keeps explicit grade denominators separate', () => {
    const db = database();
    for (let index = 0; index < 5; index += 1) {
      for (const [prefix, title, lower, skill] of [
        ['s', 'Senior Frontend Developer', 100000, 'TypeScript'],
        ['j', 'Junior Frontend Developer', 50000, 'HTML'],
        ['u', 'Frontend Developer', 70000, 'SQL'],
      ] as const) {
        const id = `${prefix}-${index}`;
        store(db, id, { ...lever(id, 'per-year-salary').salary, from: lower, to: lower + 20000 });
        db.prepare(
          'UPDATE catalog_entries SET title = ?, role_slug = ?, skills_json = ? WHERE cluster_id = ?',
        ).run(title, `${prefix}-frontend`, JSON.stringify([skill]), id);
      }
      store(db, `other-${index}`, lever(`other-${index}`, 'per-year-salary').salary);
      db.prepare('UPDATE catalog_entries SET title = ?, role_slug = ? WHERE cluster_id = ?').run(
        'Cosmic Happiness Guru',
        'frontend-developer',
        `other-${index}`,
      );
    }
    const snapshots = computeSalaryMarketSnapshots(db, new Date(observedAt));
    const canonical = snapshots.find((snapshot) => snapshot.profession?.kind === 'b267');
    expect(canonical?.profession).toMatchObject({ kind: 'b267', roleId: 'eng.frontend.ic' });
    expect(canonical?.sampleSize).toBe(15);
    expect(canonical?.grades).toBe('published_title_evidence');
    expect(canonical?.gradeSlices?.map((slice) => [slice.grade, slice.sampleSize])).toEqual([
      ['junior', 5],
      ['senior', 5],
      ['unknown', 5],
    ]);
    const senior = canonical?.gradeSlices?.find((slice) => slice.grade === 'senior');
    const junior = canonical?.gradeSlices?.find((slice) => slice.grade === 'junior');
    expect(senior?.skills).toEqual([{ name: 'TypeScript', count: 5, frequency: 100 }]);
    expect(junior?.skills).toEqual([{ name: 'HTML', count: 5, frequency: 100 }]);
    expect(senior?.evidence).toEqual({ field: 'title', markers: ['Senior'] });
    if (senior?.salary.status !== 'available' || junior?.salary.status !== 'available')
      throw new Error('No separate grade distributions');
    expect(senior.salary.groups[0]?.lower.p50).toBe(100000);
    expect(junior.salary.groups[0]?.lower.p50).toBe(50000);
    expect(
      snapshots.find((snapshot) => snapshot.profession?.kind === 'unclassified_title')?.sampleSize,
    ).toBe(5);
    db.close();
  });
  it('classifies all eligible aliases before limiting published professions and caps salary cohorts', () => {
    const db = database();
    for (let index = 0; index < 120; index += 1) {
      store(db, `alias-${index}`, lever(String(index), 'per-year-salary').salary);
      db.prepare('UPDATE catalog_entries SET title = ?, role_slug = ? WHERE cluster_id = ?').run(
        `Senior Frontend Developer (team ${index})`,
        `legacy-title-${index}`,
        `alias-${index}`,
      );
    }
    for (let index = 0; index < 105; index += 1) {
      store(db, `unknown-${index}`, null);
      db.prepare('UPDATE catalog_entries SET title = ? WHERE cluster_id = ?').run(
        `Cosmic Guru ${index}`,
        `unknown-${index}`,
      );
    }
    const snapshots = computeSalaryMarketSnapshots(db, new Date(observedAt));
    expect(snapshots).toHaveLength(100);
    expect(snapshots.find((snapshot) => snapshot.profession?.kind === 'b267')?.sampleSize).toBe(
      120,
    );
    db.close();
  });
  it('bounds published currency cohorts with explicit excluded observation counts', () => {
    const db = database();
    const currencies = [
      'USD',
      'EUR',
      'GBP',
      'CAD',
      'AUD',
      'CHF',
      'JPY',
      'RUB',
      'CNY',
      'INR',
      'BRL',
      'AED',
      'SAR',
    ];
    for (const currency of currencies)
      for (let index = 0; index < 5; index += 1) {
        const id = `${currency}-${index}`;
        store(db, id, { ...lever(id, 'per-year-salary').salary, currency });
        db.prepare('UPDATE catalog_entries SET title = ? WHERE cluster_id = ?').run(
          'Frontend Developer',
          id,
        );
      }
    const [snapshot] = computeSalaryMarketSnapshots(db, new Date(observedAt));
    if (snapshot?.salary.status !== 'available') throw new Error('No cohort distribution');
    expect(snapshot.salary.groups).toHaveLength(12);
    expect(snapshot.salary.excluded.outsidePublishedGroups).toBe(5);
    expect(snapshot.sampleSize).toBe(65);
    db.close();
  });
  it('excludes missing period, mismatching provenance and open ranges with honest counts', () => {
    const db = database();
    store(db, 'legacy', lever('legacy').salary);
    store(db, 'missing-currency', {
      ...lever('missing-currency', 'per-year-salary').salary,
      currency: undefined,
    });
    store(db, 'open', { ...lever('open', 'per-year-salary').salary, to: undefined });
    store(db, 'invalid', {
      ...lever('invalid', 'per-year-salary').salary,
      from: 200000,
      to: 100000,
    });
    store(db, 'forged-period', {
      ...lever('forged-period', 'per-year-salary').salary,
      period: 'month',
    });
    const [snapshot] = computeSalaryMarketSnapshots(db, new Date(observedAt));
    expect(snapshot?.salary.status).toBe('unavailable');
    expect(snapshot?.salary.excluded).toMatchObject({
      missingPeriod: 2,
      missingCurrency: 1,
      openRange: 1,
      invalidRange: 1,
    });
    db.close();
  });
});
