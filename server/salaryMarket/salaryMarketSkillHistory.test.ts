import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { SalaryMarketSnapshot } from '../../shared/salaryMarketSnapshot';
import { readSalaryMarketSnapshot, writeSalaryMarketSnapshots } from './salaryMarketSnapshot';
import {
  readSalarySkillHistory,
  SALARY_SKILL_HISTORY_METHOD_VERSION,
} from './salaryMarketSkillHistory';

function sample(count = 10, size = 20, name = 'SQL'): SalaryMarketSnapshot {
  const skills = [{ name, count, frequency: (count / size) * 100 }];
  const salary = {
    status: 'unavailable' as const,
    reason: 'missing_explicit_salary_period' as const,
    excluded: {
      missingPeriod: size,
      missingCurrency: 0,
      openRange: 0,
      invalidRange: 0,
      belowMinimumSample: 0,
    },
  };
  return {
    role: 'frontend-engineer',
    roleLabel: 'Frontend Engineer',
    profession: { kind: 'b267', roleId: 'eng.frontend.ic' },
    windowDays: 90,
    updatedAt: '2026-01-05T00:00:00Z',
    sampleSize: size,
    skills,
    salary,
    grades: 'published_title_evidence',
    quarterlyTrend: 'unavailable',
    source: 'deduplicated_public_catalog',
    gradeSlices: [
      {
        grade: 'senior',
        sampleSize: size,
        skills,
        salary,
        evidence: { field: 'title', markers: ['Senior'] },
      },
    ],
  };
}
function write(db: DatabaseSync, date: string, value = sample()) {
  writeSalaryMarketSnapshots(db, [value], new Date(date));
  return readSalaryMarketSnapshot(db, value.role)!;
}

describe('actual weekly skill observations', () => {
  it('starts with honest insufficient history and keeps the first real observation of each UTC week immutable', () => {
    const db = new DatabaseSync(':memory:');
    const first = write(db, '2026-01-05T12:00:00Z');
    expect(first.skillQuarterlyTrend).toMatchObject({
      status: 'insufficient_history',
      earliestActualObservation: '2026-01-05T12:00:00.000Z',
      current: { observedAt: '2026-01-05T12:00:00.000Z', sampleSize: 20 },
    });
    const fresh = write(db, '2026-01-08T12:00:00Z', sample(15));
    const history = readSalarySkillHistory(
      db,
      'frontend-engineer',
      new Date('2026-01-08T12:00:00Z'),
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      weekStart: '2026-01-05',
      observedAt: '2026-01-05T12:00:00.000Z',
      skills: [{ name: 'SQL', count: 10 }],
    });
    expect(fresh.skillQuarterlyTrend?.current.observedAt).toBe('2026-01-08T12:00:00.000Z');
    expect(fresh.skills[0]?.frequency).toBe(75);
    db.close();
  });
  it('compares real counts after 90 days, with separate actual dates and denominators for each grade', () => {
    const db = new DatabaseSync(':memory:');
    const initial = sample(20, 40);
    const current = sample(30, 40);
    const oldGrade = {
      ...initial.gradeSlices![0]!,
      sampleSize: 10,
      skills: [{ name: 'SQL', count: 2, frequency: 20 }],
    };
    const newGrade = {
      ...current.gradeSlices![0]!,
      sampleSize: 5,
      skills: [{ name: 'SQL', count: 3, frequency: 60 }],
    };
    write(db, '2026-01-05T12:00:00Z', { ...initial, gradeSlices: [oldGrade] });
    const latest = write(db, '2026-04-05T12:00:00Z', { ...current, gradeSlices: [newGrade] });
    expect(latest.skillQuarterlyTrend).toMatchObject({
      status: 'available',
      method: 'observed_catalog_skill_frequency_pp',
      methodVersion: SALARY_SKILL_HISTORY_METHOD_VERSION,
      current: { sampleSize: 40, observedAt: '2026-04-05T12:00:00.000Z' },
      baseline: { sampleSize: 40, observedAt: '2026-01-05T12:00:00.000Z' },
      skills: [{ name: 'SQL', currentFrequency: 75, baselineFrequency: 50, changePP: 25 }],
    });
    expect(latest.quarterlyTrend).toBe('available');
    expect(latest.gradeSlices?.[0]?.skillQuarterlyTrend).toMatchObject({
      status: 'available',
      current: { sampleSize: 5 },
      baseline: { sampleSize: 10 },
      skills: [{ changePP: 40 }],
    });
    db.close();
  });
  it('does not infer zero for a skill absent from the old published top15', () => {
    const db = new DatabaseSync(':memory:');
    write(db, '2026-01-05T12:00:00Z', sample());
    const latest = write(db, '2026-04-05T12:00:00Z', sample(12, 20, 'TypeScript'));
    expect(latest.skillQuarterlyTrend).toMatchObject({
      status: 'available',
      skills: [
        {
          name: 'TypeScript',
          status: 'baseline_skill_unavailable',
          baselineCount: null,
          baselineFrequency: null,
          changePP: null,
        },
      ],
    });
    expect(latest.quarterlyTrend).toBe('unavailable');
    db.close();
  });
  it('requires a baseline in the 90–97 day window and ignores future or other-method observations', () => {
    const db = new DatabaseSync(':memory:');
    write(db, '2026-01-05T12:00:00Z');
    expect(write(db, '2026-04-04T12:00:00Z').skillQuarterlyTrend?.status).toBe(
      'insufficient_history',
    );
    expect(write(db, '2026-04-12T12:00:00Z').skillQuarterlyTrend?.status).toBe('available');
    expect(write(db, '2026-04-13T12:00:00Z').skillQuarterlyTrend?.status).toBe(
      'insufficient_history',
    );
    db.exec("UPDATE salary_market_skill_history SET method_version = 'different-method'");
    expect(write(db, '2026-04-14T12:00:00Z').skillQuarterlyTrend?.status).toBe(
      'insufficient_history',
    );
    db.exec("UPDATE salary_market_skill_history SET observed_at = '2027-01-01T00:00:00.000Z'");
    expect(
      readSalarySkillHistory(db, 'frontend-engineer', new Date('2026-04-14T12:00:00Z')),
    ).toEqual([]);
    db.close();
  });
  it('ignores zero denominators and never computes percentage points from them', () => {
    const db = new DatabaseSync(':memory:');
    write(db, '2026-01-05T12:00:00Z', sample(0, 0));
    expect(
      readSalarySkillHistory(db, 'frontend-engineer', new Date('2026-01-05T12:00:00Z')),
    ).toEqual([]);
    write(db, '2026-01-06T12:00:00Z');
    const latest = write(db, '2026-04-06T12:00:00Z', sample(0, 0));
    expect(latest.skillQuarterlyTrend).toMatchObject({
      status: 'insufficient_sample',
      current: { sampleSize: 0 },
      baseline: { sampleSize: 20 },
    });
    expect(latest.skillQuarterlyTrend).not.toHaveProperty('skills');
    db.close();
  });
  it('does not borrow an aggregate baseline for a grade that had not been observed', () => {
    const db = new DatabaseSync(':memory:');
    write(db, '2026-01-05T12:00:00Z', { ...sample(), gradeSlices: [], grades: 'unavailable' });
    const latest = write(db, '2026-04-05T12:00:00Z');
    expect(latest.skillQuarterlyTrend?.status).toBe('available');
    expect(latest.gradeSlices?.[0]?.skillQuarterlyTrend).toMatchObject({
      status: 'insufficient_history',
      earliestActualObservation: '2026-04-05T12:00:00.000Z',
    });
    db.close();
  });
  it('uses unrounded counts for percentage-point differences', () => {
    const db = new DatabaseSync(':memory:');
    write(db, '2026-01-05T12:00:00Z', sample(1, 12));
    const latest = write(db, '2026-04-05T12:00:00Z', sample(1, 6));
    expect(latest.skillQuarterlyTrend).toMatchObject({
      status: 'available',
      skills: [{ currentFrequency: 16.67, baselineFrequency: 8.33, changePP: 8.33 }],
    });
    db.close();
  });
  it('ignores a corrupted historical denominator or skill count instead of publishing a comparison', () => {
    for (const corrupt of [
      { sampleSize: 0 },
      { sampleSize: -1 },
      { skills: [{ name: 'SQL', count: 21 }] },
      { skills: [{ name: 'SQL', count: 0.5 }] },
    ]) {
      const db = new DatabaseSync(':memory:');
      write(db, '2026-01-05T12:00:00Z');
      const row = db.prepare('SELECT payload FROM salary_market_skill_history').get()!;
      db.prepare('UPDATE salary_market_skill_history SET payload=?').run(
        JSON.stringify({ ...JSON.parse(String(row.payload)), ...corrupt }),
      );
      expect(write(db, '2026-04-05T12:00:00Z').skillQuarterlyTrend?.status).toBe(
        'insufficient_history',
      );
      db.close();
    }
  });
  it('retains at most 16 weeks and only the bounded current canonical roles', () => {
    const db = new DatabaseSync(':memory:');
    for (let week = 0; week < 20; week += 1) {
      const date = new Date('2026-01-05T12:00:00Z');
      date.setUTCDate(date.getUTCDate() + week * 7);
      writeSalaryMarketSnapshots(db, [sample()], date);
    }
    const date = new Date('2026-05-18T12:00:00Z');
    expect(readSalarySkillHistory(db, 'frontend-engineer', date)).toHaveLength(16);
    const many = Array.from({ length: 110 }, (_, index) => ({
      ...sample(),
      role: `role-${index}`,
    }));
    writeSalaryMarketSnapshots(db, many, date);
    expect(
      db.prepare('SELECT count(DISTINCT role) AS n FROM salary_market_skill_history').get()!.n,
    ).toBe(100);
    expect(readSalarySkillHistory(db, 'frontend-engineer', date)).toEqual([]);
    db.close();
  });
  it('rolls history back together with a failed latest-snapshot publication', () => {
    const db = new DatabaseSync(':memory:');
    write(db, '2026-01-05T12:00:00Z');
    expect(() =>
      writeSalaryMarketSnapshots(db, [sample(15), sample(15)], new Date('2026-01-12T12:00:00Z')),
    ).toThrow();
    expect(
      readSalarySkillHistory(db, 'frontend-engineer', new Date('2026-01-12T12:00:00Z')),
    ).toHaveLength(1);
    expect(readSalaryMarketSnapshot(db, 'frontend-engineer')?.skills[0]?.count).toBe(10);
    db.close();
  });
});
