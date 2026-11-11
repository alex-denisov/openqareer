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

describe('PlacementBackfill adopts employers outside the directory', () => {
  it('creates the company for an unlinked board and ties the placement to it', () => {
    const db = openDb();
    db.exec(`ALTER TABLE company_directory ADD COLUMN source_type TEXT NOT NULL DEFAULT 'x';
      ALTER TABLE company_directory ADD COLUMN created_at TEXT NOT NULL DEFAULT 'x';
      ALTER TABLE company_directory ADD COLUMN updated_at TEXT NOT NULL DEFAULT 'x';
      ALTER TABLE company_directory ADD COLUMN evidence TEXT;
      CREATE TABLE vacancy_pool_index (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, expired INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE vacancy_cluster_input (id TEXT PRIMARY KEY, cluster_json TEXT NOT NULL);
      INSERT INTO vacancy_source_state VALUES ('src-apple-jobs');
      INSERT INTO vacancy_pool_index (id, source_id) VALUES ('v1', 'src-apple-jobs');
      INSERT INTO vacancy_cluster_input VALUES ('v1', '{"company":"Apple"}');`);
    const step = new PlacementBackfill(db, { chunk: 50, now: () => 1 });
    let report = step.step();
    while (!report.done) report = step.step();
    expect(report.adoptedCompanies).toBe(1);
    expect(db.prepare(`SELECT company_key FROM company_placement WHERE source_id = 'src-apple-jobs'`).get()).toEqual({ company_key: 'apple' });
    db.exec(`INSERT INTO company_directory (company_key, company_name) VALUES ('x-apple', 'Shadow');`);
    const again = new PlacementBackfill(db, { chunk: 50, now: () => 2 });
    let second = again.step();
    while (!second.done) second = again.step();
    expect(second.adoptedCompanies).toBe(0);
    expect(second.changedTotal).toBe(0);
  });
  it('does not count a board whose company key the index cannot resolve as adopted again', () => {
    const db = openDb();
    db.exec(`ALTER TABLE company_directory ADD COLUMN source_type TEXT NOT NULL DEFAULT 'x';
      ALTER TABLE company_directory ADD COLUMN created_at TEXT NOT NULL DEFAULT 'x';
      ALTER TABLE company_directory ADD COLUMN updated_at TEXT NOT NULL DEFAULT 'x';
      ALTER TABLE company_directory ADD COLUMN evidence TEXT;
      CREATE TABLE vacancy_pool_index (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, expired INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE vacancy_cluster_input (id TEXT PRIMARY KEY, cluster_json TEXT NOT NULL);
      INSERT INTO company_directory (company_key, company_name) VALUES ('acme', 'Other Acme');
      INSERT INTO vacancy_source_state VALUES ('ats-lever-acme');
      INSERT INTO vacancy_pool_index (id, source_id) VALUES ('v1', 'ats-lever-acme');
      INSERT INTO vacancy_cluster_input VALUES ('v1', '{"company":"Acme Lever"}');`);
    const passes = [1, 2].map((now) => {
      const step = new PlacementBackfill(db, { chunk: 50, now: () => now });
      let report = step.step();
      while (!report.done) report = step.step();
      return report.adoptedCompanies;
    });
    expect(passes).toEqual([0, 0]);
  });
});

describe('PlacementBackfill source index cache', () => {
  it('reuses the board map within an hour and rereads it after', () => {
    const db = openDb();
    let clock = 1;
    const step = new PlacementBackfill(db, { chunk: 50, now: () => clock });
    runAll(step);
    db.exec(`INSERT INTO vacancy_source_state VALUES ('ats-lever-lonely')`);
    runAll(step);
    expect(db.prepare(`SELECT count(*) n FROM company_placement WHERE source_id = 'ats-lever-lonely'`).get()).toEqual({ n: 0 });
    clock += 61 * 60_000;
    runAll(step);
    // Размещение из справочника получает площадку, появившуюся позже.
    expect(db.prepare(`SELECT source_id, company_key FROM company_placement WHERE placement_id = 'ats:lever:lonely'`).get())
      .toEqual({ source_id: 'ats-lever-lonely', company_key: 'lonely' });
  });
});

describe('PlacementBackfillTicker pause', () => {
  it('repeats soon after a pass that adopted companies', async () => {
    const { PlacementBackfillTicker, PLACEMENT_ADOPT_PAUSE_MS } = await import('./placementBackfill');
    let clock = 0;
    let calls = 0;
    const step = () => { calls += 1; return { done: true, processed: 1, changed: 1, changedTotal: 1, duplicateSources: 0, adoptedCompanies: 3, ms: 1 }; };
    const ticker = new PlacementBackfillTicker({ step }, () => clock);
    ticker.tick();
    clock += PLACEMENT_ADOPT_PAUSE_MS;
    ticker.tick();
    expect(calls).toBe(2);
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
      return { done: calls === 5, processed: 1, changed: 1, changedTotal: calls, duplicateSources: 0, adoptedCompanies: 0, ms: 100 };
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
