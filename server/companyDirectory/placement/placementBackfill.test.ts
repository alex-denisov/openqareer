import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PlacementBackfill } from './placementBackfill';
import { PLACEMENT_TABLES } from './placementSchema';

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE company_directory (company_key TEXT PRIMARY KEY, company_name TEXT NOT NULL,
    website_url TEXT, careers_url TEXT, ats_provider TEXT, ats_slug TEXT, status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE vacancy_source_state (source_id TEXT PRIMARY KEY);`);
  db.exec(PLACEMENT_TABLES);
  const company = db.prepare('INSERT INTO company_directory (company_key, company_name, website_url, careers_url, ats_provider, ats_slug) VALUES (?,?,?,?,?,?)');
  company.run('stripe', 'Stripe', 'https://stripe.com', null, 'greenhouse', 'Stripe');
  company.run('tonies', 'tonies', 'https://www.tonies.com/', 'https://tonies.com/jobs', null, null);
  company.run('tonies-de', 'tonies DE', 'https://tonies.com/de', null, null, null);
  company.run('lonely', 'Lonely', null, null, 'lever', 'lonely');
  const source = db.prepare('INSERT INTO vacancy_source_state (source_id) VALUES (?)');
  for (const id of ['ats-greenhouse-stripe', 'src-company-site-tonies', 'src-hh-search', 'src-fh-greenhouse-stripe']) source.run(id);
  return db;
}

const rows = (db: DatabaseSync) =>
  db.prepare('SELECT placement_id, company_key, type, source_id, discovered_by FROM company_placement ORDER BY placement_id').all();

function runAll(step: PlacementBackfill): number {
  let steps = 0;
  while (!step.step().done) steps += 1;
  return steps;
}

describe('PlacementBackfill', () => {
  it('keeps the first company of a shared site host on every pass', () => {
    const db = openDb();
    for (const now of [1, 2]) runAll(new PlacementBackfill(db, { chunk: 2, now: () => now }));
    expect(db.prepare(`SELECT company_key FROM company_placement WHERE placement_id = 'site:tonies.com'`).get())
      .toEqual({ company_key: 'tonies' });
  });

  it('fills placements from sources and directory boards and sites', () => {
    const db = openDb();
    runAll(new PlacementBackfill(db, { chunk: 2, now: () => 1 }));
    expect(rows(db)).toEqual([
      { placement_id: 'agg:src-hh-search', company_key: null, type: 'aggregator', source_id: 'src-hh-search', discovered_by: 'source' },
      { placement_id: 'ats:greenhouse:stripe', company_key: 'stripe', type: 'ats', source_id: 'ats-greenhouse-stripe', discovered_by: 'source' },
      { placement_id: 'ats:lever:lonely', company_key: 'lonely', type: 'ats', source_id: null, discovered_by: 'directory' },
      { placement_id: 'site:src-company-site-tonies', company_key: 'tonies', type: 'employer_site', source_id: 'src-company-site-tonies', discovered_by: 'source' },
      { placement_id: 'site:stripe.com', company_key: 'stripe', type: 'employer_site', source_id: null, discovered_by: 'directory' },
      { placement_id: 'site:tonies.com', company_key: 'tonies', type: 'employer_site', source_id: null, discovered_by: 'directory' },
    ]);
  });

  it('reports a second source for the same board instead of failing', () => {
    const db = openDb();
    const step = new PlacementBackfill(db, { chunk: 50, now: () => 1 });
    let report = step.step();
    while (!report.done) report = step.step();
    expect(report.duplicateSources).toBe(1);
  });

  it('is idempotent: a second pass changes nothing', () => {
    const db = openDb();
    runAll(new PlacementBackfill(db, { chunk: 3, now: () => 1 }));
    const before = rows(db);
    const second = new PlacementBackfill(db, { chunk: 3, now: () => 2 });
    let report = second.step();
    while (!report.done) report = second.step();
    expect(rows(db)).toEqual(before);
    expect(report.changedTotal).toBe(0);
  });

  it('works in bounded chunks', () => {
    const db = openDb();
    const steps = runAll(new PlacementBackfill(db, { chunk: 1, now: () => 1 }));
    expect(steps).toBeGreaterThanOrEqual(5);
  });
});

describe('PlacementBackfillTicker', () => {
  it('stops at the budget, reports the finished pass and then pauses', async () => {
    const { PlacementBackfillTicker, PLACEMENT_PASS_PAUSE_MS } = await import('./placementBackfill');
    let clock = 0;
    let calls = 0;
    const step = () => {
      calls += 1;
      clock += 100;
      return { done: calls === 5, processed: 1, changed: 1, changedTotal: calls, duplicateSources: 0, ms: 100 };
    };
    const ticker = new PlacementBackfillTicker({ step }, () => clock);
    expect(ticker.tick()).toBeUndefined();
    expect(calls).toBe(3);
    expect(ticker.tick()?.done).toBe(true);
    expect(calls).toBe(5);
    expect(ticker.tick()).toBeUndefined();
    expect(calls).toBe(5);
    clock += PLACEMENT_PASS_PAUSE_MS;
    ticker.tick();
    expect(calls).toBeGreaterThan(5);
  });
});
