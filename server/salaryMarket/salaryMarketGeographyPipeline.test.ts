import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { computeSalaryMarketSnapshots } from './salaryMarketSnapshot';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE catalog_entries (cluster_id TEXT PRIMARY KEY, title TEXT, role_slug TEXT,
    skills_json TEXT, published_ms INTEGER, status TEXT, location TEXT, is_remote INTEGER);
    CREATE TABLE vacancy_clusters (id TEXT PRIMARY KEY, cluster_json TEXT)`);
  return db;
}
const now = new Date('2026-10-24T00:00:00Z');
function add(
  db: DatabaseSync,
  prefix: string,
  count: number,
  location: string | null,
  remote: boolean,
  amount: number,
  skill: string,
  grade = 'Senior',
) {
  for (let index = 0; index < count; index += 1) {
    const id = `${prefix}-${index}`;
    db.prepare('INSERT INTO catalog_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      id,
      `${grade} Frontend Developer`,
      'frontend-developer',
      JSON.stringify([skill, 'SQL', 'SQL']),
      now.getTime(),
      'active',
      location,
      Number(remote),
    );
    db.prepare('INSERT INTO vacancy_clusters VALUES (?, ?)').run(
      id,
      JSON.stringify({
        salary: {
          from: amount,
          to: amount * 1.2,
          currency: 'USD',
          gross: true,
          period: 'year',
          periodEvidence: { field: 'lever.salaryRange.interval', value: 'per-year-salary' },
        },
        // Company-office fallbacks must never qualify unknown source geography.
        companyFeatures: { country: 'Germany' },
      }),
    );
  }
}

describe('prepared salary geographic cohorts', () => {
  it('keeps independent denominators, Top15, grade slices and closed-range percentiles', () => {
    const db = database();
    add(db, 'de-senior', 5, 'Berlin, Germany', true, 100000, 'TypeScript');
    add(db, 'de-junior', 5, 'Germany', true, 50000, 'JavaScript', 'Junior');
    add(db, 'ae', 5, 'United Arab Emirates', false, 300000, 'Rust');
    add(db, 'kz', 5, 'Казахстан', true, 200000, 'Go', 'Middle');
    add(db, 'city-only', 1, 'Berlin', true, 999999, 'Unknown');
    add(db, 'missing', 1, null, false, 999999, 'Unknown');
    add(db, 'mixed', 1, 'Germany / UAE', true, 999999, 'Unknown');
    add(db, 'ru', 1, 'Россия', false, 999999, 'Russian');
    add(db, 'us', 1, 'United States', false, 999999, 'US');
    const result = computeSalaryMarketSnapshots(db, now);
    expect(result).toHaveLength(1);
    const snapshot = result[0]!;
    expect(snapshot.sampleSize).toBe(25);
    expect(snapshot.geography).toEqual({
      method: 'explicit_source_country_v1',
      regionPolicy: 'openqareer_candidate_regions_v1',
      explicitCountryCount: 22,
      unknownCountryCount: 2,
      ambiguousCountryCount: 1,
      remoteCount: 17,
    });
    expect(snapshot.locationSlices).toHaveLength(4);
    const europe = snapshot.locationSlices!.find((slice) => slice.location === 'europe')!;
    const remote = snapshot.locationSlices!.find((slice) => slice.location === 'remote')!;
    const uae = snapshot.locationSlices!.find((slice) => slice.location === 'uae')!;
    const cis = snapshot.locationSlices!.find((slice) => slice.location === 'cis')!;
    expect([europe.sampleSize, remote.sampleSize, uae.sampleSize, cis.sampleSize]).toEqual([
      10, 17, 5, 5,
    ]);
    expect(europe.skills.find((skill) => skill.name === 'SQL')).toMatchObject({
      count: 10,
      frequency: 100,
    });
    expect(europe.skills.find((skill) => skill.name === 'TypeScript')).toMatchObject({
      count: 5,
      frequency: 50,
    });
    expect(europe.skills.some((skill) => skill.name === 'Unknown')).toBe(false);
    expect(europe.gradeSlices!.map((slice) => [slice.grade, slice.sampleSize])).toEqual([
      ['junior', 5],
      ['senior', 5],
    ]);
    expect(europe.salary.status).toBe('available');
    if (europe.salary.status === 'available')
      expect(europe.salary.groups[0]!.lower.p50).toBe(50000);
    const senior = europe.gradeSlices!.find((slice) => slice.grade === 'senior')!;
    if (senior.salary.status === 'available')
      expect(senior.salary.groups[0]!.lower.p50).toBe(100000);
    else throw new Error('expected five independently comparable senior salaries');
    if (uae.salary.status === 'available') expect(uae.salary.groups[0]!.lower.p50).toBe(300000);
    else throw new Error('expected UAE salary evidence');
    if (cis.salary.status === 'available') expect(cis.salary.groups[0]!.lower.p50).toBe(200000);
    else throw new Error('expected CIS salary evidence');
    expect(
      db
        .prepare(
          "SELECT count(*) AS count FROM sqlite_temp_master WHERE name LIKE 'salary_market_%'",
        )
        .get(),
    ).toEqual({ count: 0 });
    db.close();
  });
  it('does not reuse global salary publication minimum for a small region', () => {
    const db = database();
    add(db, 'de', 4, 'Germany', false, 100000, 'SQL');
    add(db, 'ae', 5, 'UAE', false, 200000, 'Rust');
    const snapshot = computeSalaryMarketSnapshots(db, now)[0]!;
    expect(snapshot.salary.status).toBe('available');
    const europe = snapshot.locationSlices!.find((slice) => slice.location === 'europe')!;
    expect(europe.sampleSize).toBe(4);
    expect(europe.salary.status).toBe('unavailable');
    expect(europe.salary.excluded.belowMinimumSample).toBe(4);
    db.close();
  });
});
