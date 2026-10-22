import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  computeSalaryMarketSnapshots,
  readSalaryMarketSnapshot,
  writeSalaryMarketSnapshots,
  salaryPercentiles,
} from './salaryMarketSnapshot';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    `CREATE TABLE catalog_entries (cluster_id TEXT PRIMARY KEY, role_slug TEXT, role_label TEXT, skills_json TEXT, published_ms INTEGER, status TEXT)`,
  );
  const insert = db.prepare('INSERT INTO catalog_entries VALUES (?, ?, ?, ?, ?, ?)');
  const now = Date.parse('2026-10-23T00:00:00Z');
  insert.run('a', 'developer', 'Developer', '["TypeScript","TypeScript","SQL"]', now, 'active');
  insert.run('b', 'developer', 'Developer', '["SQL"]', now, 'active');
  insert.run('old', 'developer', 'Developer', '["Old"]', now - 91 * 86400000, 'active');
  insert.run('archived', 'developer', 'Developer', '["Old"]', now, 'archived');
  insert.run('future', 'developer', 'Developer', '["Future"]', now + 1, 'active');
  return { db, now };
}

describe('public salary market snapshot', () => {
  it('counts unique clusters within 90 days and each skill once per cluster', () => {
    const { db, now } = fixture();
    const [snapshot] = computeSalaryMarketSnapshots(db, new Date(now));
    expect(snapshot?.sampleSize).toBe(2);
    expect(snapshot?.skills).toEqual([
      { name: 'SQL', count: 2, frequency: 100 },
      { name: 'TypeScript', count: 1, frequency: 50 },
    ]);
    expect(snapshot?.salary).toEqual({
      status: 'unavailable',
      reason: 'missing_explicit_salary_period',
    });
    expect(snapshot?.quarterlyTrend).toBe('unavailable');
    db.close();
  });
  it('publishes atomically and reads only the requested role; missing snapshot is null', () => {
    const { db, now } = fixture();
    expect(readSalaryMarketSnapshot(db, 'developer')).toBeNull();
    const snapshots = computeSalaryMarketSnapshots(db, new Date(now));
    writeSalaryMarketSnapshots(db, snapshots);
    expect(readSalaryMarketSnapshot(db, 'developer')).toEqual(snapshots[0]);
    expect(readSalaryMarketSnapshot(db, 'unknown')).toBeNull();
    writeSalaryMarketSnapshots(db, []);
    expect(readSalaryMarketSnapshot(db, 'developer')).toBeNull();
    db.close();
  });
  it('cleans temporary counters on success and failed computation before a repeated run', () => {
    const { db, now } = fixture();
    db.exec(`CREATE TEMP TABLE salary_market_skill_counts (
      role TEXT, skill TEXT, count INTEGER CHECK(count < 1), PRIMARY KEY(role, skill))`);
    expect(() => computeSalaryMarketSnapshots(db, new Date(now))).toThrow();
    expect(
      db
        .prepare("SELECT 1 FROM sqlite_temp_master WHERE name = 'salary_market_skill_counts'")
        .get(),
    ).toBeUndefined();
    expect(computeSalaryMarketSnapshots(db, new Date(now))[0]?.sampleSize).toBe(2);
    expect(
      db
        .prepare("SELECT 1 FROM sqlite_temp_master WHERE name = 'salary_market_skill_counts'")
        .get(),
    ).toBeUndefined();
    db.close();
  });
  it('rejects malformed skills without changing the vacancy denominator', () => {
    const { db, now } = fixture();
    db.prepare('UPDATE catalog_entries SET skills_json = ? WHERE cluster_id = ?').run(
      'broken',
      'a',
    );
    const [snapshot] = computeSalaryMarketSnapshots(db, new Date(now));
    expect(snapshot?.sampleSize).toBe(2);
    expect(snapshot?.skills).toEqual([{ name: 'SQL', count: 1, frequency: 50 }]);
    db.close();
  });
});

describe('salary evidence', () => {
  const observation = {
    clusterId: 'a',
    amount: 100,
    currency: 'EUR',
    period: 'month' as const,
    gross: true,
  };
  it('computes nearest-rank percentiles only for a comparable evidence group', () => {
    expect(
      salaryPercentiles(
        [100, 200, 300, 400].map((amount, index) => ({
          ...observation,
          amount,
          clusterId: String(index),
        })),
      ),
    ).toEqual({ p25: 100, p50: 200, p75: 300, p90: 400 });
  });
  it('refuses mixed periods, currencies, tax bases and invalid amounts', () => {
    for (const other of [
      { ...observation, period: 'year' as const },
      { ...observation, currency: 'USD' },
      { ...observation, gross: false },
      { ...observation, amount: NaN },
    ]) {
      expect(salaryPercentiles([observation, { ...other, clusterId: 'b' }])).toBeNull();
    }
    expect(salaryPercentiles([])).toBeNull();
    expect(salaryPercentiles([observation, observation])).toBeNull();
  });
});
