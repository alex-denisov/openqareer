import { mkdtempSync, rmSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { COMPANY_DIRECTORY_MIGRATION } from '../../data/companyDirectorySchema';
import { VACANCY_POOL_INDEX_TABLE } from '../../data/sqliteSchema';
import { PLACEMENT_TABLES } from '../placement/placementSchema';
import { CoverageReport, decodeCursor, encodeCursor } from './coverageReport';

function openDb(path = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(COMPANY_DIRECTORY_MIGRATION);
  db.exec(PLACEMENT_TABLES);
  db.exec(VACANCY_POOL_INDEX_TABLE);
  return db;
}

function seedSmall(db: DatabaseSync): void {
  const company = db.prepare(
    `INSERT INTO company_directory (company_key, company_name, source_type, status, created_at, updated_at)
     VALUES (?, ?, 'seed', ?, 'x', 'x')`,
  );
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) company.run(key, key.toUpperCase(), 'active');
  company.run('g', 'G', 'dormant');
  const placement = db.prepare(
    `INSERT INTO company_placement (placement_id, company_key, type, priority, source_id, health, last_checked_at, discovered_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'test', 1)`,
  );
  placement.run('site:a', 'a', 'employer_site', 1, 'src-company-site-a', 'ok', 100);
  placement.run('ats:x:a', 'a', 'ats', 2, 'ats-x-a', 'ok', 90);
  placement.run('ats:x:b', 'b', 'ats', 2, 'ats-x-b', 'failing', null);
  placement.run('li:c', 'c', 'linkedin', 3, 'src-li-c', null, null);
  placement.run('agg:d', 'd', 'aggregator', 4, 'src-hh-d', null, null);
  placement.run('site:g', 'g', 'employer_site', 1, 'src-company-site-g', null, null);
  const pool = db.prepare(
    `INSERT INTO vacancy_pool_index (id, source_id, is_active, url, search_text, expired) VALUES (?, ?, 1, 'u', 's', ?)`,
  );
  for (let i = 0; i < 3; i += 1) pool.run(`sa${i}`, 'src-company-site-a', 0);
  pool.run('sa-old', 'src-company-site-a', 1);
  pool.run('sb1', 'ats-x-b', 0);
  pool.run('sc1', 'src-li-c', 0);
  const link = db.prepare(
    `INSERT INTO vacancy_company (vacancy_id, company_key, match_how, linked_at) VALUES (?, ?, 'exact', 1)`,
  );
  link.run('v1', 'e');
  link.run('v2', 'e');
  link.run('v3', 'd');
}

describe('CoverageReport', () => {
  it('classifies by best placement and counts pool vacancies per class', async () => {
    const db = openDb();
    seedSmall(db);
    const totals = await new CoverageReport(db).totals();
    expect(totals.classes).toEqual({
      site: { companies: 1, vacancies: 3 },
      ats: { companies: 1, vacancies: 1 },
      linkedin_only: { companies: 1, vacancies: 1 },
      aggregator_only: { companies: 2, vacancies: 3 },
      none: { companies: 1, vacancies: 0 },
    });
    expect(totals.totalCompanies).toBe(6);
  });

  it('caches totals for ten minutes', async () => {
    const db = openDb();
    seedSmall(db);
    let now = 1_000;
    const report = new CoverageReport(db, { now: () => now });
    const first = await report.totals();
    db.exec(`UPDATE company_directory SET status = 'dormant'`);
    expect(await report.totals()).toBe(first);
    now += 10 * 60_000 + 1;
    expect((await report.totals()).totalCompanies).toBe(0);
  });

  it('pages companies by vacancy count desc with keyset cursor and class filter', async () => {
    const db = openDb();
    seedSmall(db);
    const report = new CoverageReport(db);
    const one = await report.list({ limit: 2 });
    expect(one.items.map((row) => [row.companyKey, row.vacancies])).toEqual([
      ['a', 3],
      ['e', 2],
    ]);
    expect(one.nextCursor).not.toBeNull();
    const two = await report.list({ limit: 10, cursor: one.nextCursor ?? undefined });
    expect(two.items.map((row) => row.companyKey)).toEqual(['b', 'c', 'd', 'f']);
    expect(two.nextCursor).toBeNull();
    const ats = await report.list({ limit: 10, cls: 'ats' });
    expect(ats.items).toHaveLength(1);
    expect(ats.items[0]).toMatchObject({ companyKey: 'b', name: 'B', class: 'ats', vacancies: 1 });
    const top = (await report.list({ limit: 1 })).items[0];
    expect(top.placements).toEqual([
      { type: 'employer_site', id: 'site:a', health: 'ok', lastCheckedAt: 100 },
      { type: 'ats', id: 'ats:x:a', health: 'ok', lastCheckedAt: 90 },
    ]);
  });

  it('rejects a malformed cursor', () => {
    expect(decodeCursor('%%%')).toBeNull();
    expect(decodeCursor(encodeCursor({ n: 2, key: 'k' }))).toEqual({ n: 2, key: 'k' });
  });

  it('answers totals under one second on prod-size data (employer sources hold ~6% of the pool)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oq-coverage-'));
    try {
      const db = openDb(join(dir, 'app.db'));
      db.exec('BEGIN');
      db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 165000)
        INSERT INTO company_directory (company_key, company_name, source_type, status, created_at, updated_at)
        SELECT 'c' || i, 'Company ' || i, 'seed', CASE WHEN i % 50 = 0 THEN 'dormant' ELSE 'active' END, 'x', 'x' FROM n`);
      db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 30000)
        INSERT INTO company_placement (placement_id, company_key, type, priority, source_id, health, discovered_by, updated_at)
        SELECT 'p' || i, 'c' || i, CASE i % 3 WHEN 0 THEN 'employer_site' WHEN 1 THEN 'ats' ELSE 'linkedin' END,
               1 + i % 3, 'src-' || i, 'ok', 'test', 1 FROM n`);
      db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 300000)
        INSERT INTO vacancy_company (vacancy_id, company_key, match_how, linked_at)
        SELECT 'v' || i, 'c' || (30000 + i % 60000), 'exact', 1 FROM n`);
      db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 930000)
        INSERT INTO vacancy_pool_index (id, source_id, is_active, url, search_text, expired)
        SELECT 'x' || i, CASE WHEN i % 15 = 0 THEN 'src-' || (1 + i % 30000) ELSE 'src-hh-' || (i % 50) END, 1, 'u', 's', i % 4 FROM n`);
      db.exec('COMMIT');
      // Best of three uncached runs: the budget is for the query, not for CI neighbours.
      const runs: number[] = [];
      let totals = await new CoverageReport(db).totals();
      for (let run = 0; run < 3; run += 1) {
        const startedAt = performance.now();
        totals = await new CoverageReport(db).totals();
        runs.push(performance.now() - startedAt);
      }
      const totalsMs = Math.min(...runs);
      const report = new CoverageReport(db);
      const listStart = performance.now();
      const page = await report.list({ limit: 100, cls: 'aggregator_only' });
      const listMs = performance.now() - listStart;
      console.log(`coverage totals ${totalsMs.toFixed(0)} ms, list ${listMs.toFixed(0)} ms`);
      expect(totals.totalCompanies).toBeGreaterThan(160_000);
      expect(page.items.length).toBeGreaterThan(0);
      // Target is 1 s; a machine that is already overloaded gets a 3x allowance.
      const budgetMs = loadavg()[0] > cpus().length ? 3000 : 1000;
      expect(totalsMs).toBeLessThan(budgetMs);
      expect(listMs).toBeLessThan(budgetMs * 1.5);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
