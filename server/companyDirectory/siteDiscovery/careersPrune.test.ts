import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { COMPANY_DIRECTORY_MIGRATION } from '../../data/companyDirectorySchema';
import { PLACEMENT_TABLES } from '../placement/placementSchema';
import { CareersPrune, CareersPruneTicker, careersDropReason, careersUrlSetAt, type SourceStateRow } from './careersPrune';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

function state(overrides: Partial<SourceStateRow> = {}, observations: Record<string, unknown> = {}): SourceStateRow {
  return {
    sourceId: 'src-company-site-acme',
    lastStatus: 'error',
    lastErrorMessage: 'vacancy_source_unreachable: 403',
    itemsFoundTotal: 0,
    careersUrlSetAt: NOW - 10 * DAY,
    observations: JSON.stringify({
      firstReadingAt: iso(NOW - 3 * DAY),
      lastNonEmptyReadingAt: null,
      windowReadings: 3,
      consecutiveEmptyReadings: 0,
      census: null,
      ...observations,
    }),
    ...overrides,
  };
}

describe('B643 careers drop rule', () => {
  it('drops a page that never gave items and keeps failing with HTTP 4xx/5xx or timeout', () => {
    expect(careersDropReason(state(), NOW)).toMatch(/HTTP 403/);
    expect(careersDropReason(state({ lastErrorMessage: 'vacancy_source_unreachable: 503' }), NOW)).toMatch(/HTTP 503/);
    expect(careersDropReason(state({ lastErrorMessage: 'The operation was aborted due to timeout' }), NOW)).toMatch(/timeout/);
    expect(careersDropReason(state({ lastErrorMessage: 'fetch failed (ENOTFOUND)' }), NOW)).toMatch(/no answer/);
  });

  it('keeps a page read fewer than three times', () => {
    expect(careersDropReason(state({}, { windowReadings: 2 }), NOW)).toBeUndefined();
  });

  it('keeps a page that is only rate limited or failed for another cause', () => {
    expect(careersDropReason(state({ lastErrorMessage: 'vacancy_source_unreachable: 429' }), NOW)).toBeUndefined();
    expect(careersDropReason(state({ lastErrorMessage: 'vacancy_source_transport_unavailable' }), NOW)).toBeUndefined();
  });

  it('drops a page that answers but stays empty for 14 days', () => {
    const empty = state({ lastStatus: 'degraded', lastErrorMessage: 'corporate_quality_failed', careersUrlSetAt: NOW - 20 * DAY }, { firstReadingAt: iso(NOW - 15 * DAY), windowReadings: 4 });
    expect(careersDropReason(empty, NOW)).toMatch(/0 items for 15 days/);
    const young = state({ lastStatus: 'healthy', lastErrorMessage: null }, { firstReadingAt: iso(NOW - 13 * DAY) });
    expect(careersDropReason(young, NOW)).toBeUndefined();
  });

  it('never drops a page that ever gave items', () => {
    expect(careersDropReason(state({ itemsFoundTotal: 1 }), NOW)).toBeUndefined();
    expect(careersDropReason(state({}, { lastNonEmptyReadingAt: iso(NOW - 20 * DAY) }), NOW)).toBeUndefined();
    expect(careersDropReason(state({}, { census: { total: 2 } }), NOW)).toBeUndefined();
  });

  it('never judges a URL by readings taken before it was set', () => {
    expect(careersDropReason(state({ careersUrlSetAt: NOW - 2 * DAY }), NOW)).toBeUndefined();
    expect(careersDropReason(state({ careersUrlSetAt: null }), NOW)).toBeUndefined();
  });

  it('reads the set time from evidence: explicit time first, else the B643-9 discovery day', () => {
    expect(careersUrlSetAt({ careersUrlSetAt: '2026-11-10T05:00:00.000Z' })).toBe(Date.parse('2026-11-10T05:00:00.000Z'));
    expect(careersUrlSetAt({ careersUrl: { how: 'B643-9 site path /careers, HTTP 200 on 2026-11-11' } })).toBe(Date.parse('2026-11-11T00:00:00Z'));
    expect(careersUrlSetAt({ careersUrl: { how: 'freehire.me listing' } })).toBeNull();
    expect(careersUrlSetAt(null)).toBeNull();
  });

  it('keeps a page with unreadable observations', () => {
    expect(careersDropReason(state({ observations: 'not json' }), NOW)).toBeUndefined();
    expect(careersDropReason(state({ observations: null }), NOW)).toBeUndefined();
  });
});

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(COMPANY_DIRECTORY_MIGRATION);
  db.exec('ALTER TABLE company_directory ADD COLUMN evidence TEXT');
  db.exec(`CREATE TABLE vacancy_source_state (source_id TEXT PRIMARY KEY, last_sync_at TEXT, last_status TEXT,
    last_error_message TEXT, items_found_total INTEGER NOT NULL DEFAULT 0, items_active_total INTEGER NOT NULL DEFAULT 0, observations TEXT)`);
  db.exec(PLACEMENT_TABLES);
  const company = db.prepare(`INSERT INTO company_directory (company_key, company_name, careers_url, website_url, evidence, source_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'corporate_portal', '2026-11-01', '2026-11-01')`);
  company.run('acme', 'Acme', 'https://acme.com/careers', 'https://acme.com/', '{"careersUrl":{"value":"https://acme.com/careers","how":"B643-9 site path /careers, HTTP 200 on 2026-11-01"}}');
  company.run('legacy', 'Legacy', 'https://legacy.com/careers', null, null);
  company.run('good', 'Good', 'https://good.com/jobs', null, null);
  const source = db.prepare(`INSERT INTO vacancy_source_state (source_id, last_status, last_error_message, items_found_total, observations) VALUES (?, ?, ?, ?, ?)`);
  const bad = state();
  source.run(bad.sourceId, bad.lastStatus, bad.lastErrorMessage, 0, bad.observations);
  source.run('src-company-site-good', 'healthy', null, 12, state({}, { lastNonEmptyReadingAt: iso(NOW) }).observations);
  source.run('src-company-site-legacy', bad.lastStatus, bad.lastErrorMessage, 0, bad.observations);
  source.run('src-hh-search', 'error', 'vacancy_source_unreachable: 403', 0, bad.observations);
  const placement = db.prepare(`INSERT INTO company_placement (placement_id, company_key, type, url, priority, source_id, discovered_by, updated_at)
    VALUES (?, ?, 'employer_site', ?, 3, ?, 'directory', 0)`);
  placement.run('site:acme.com', 'acme', 'https://acme.com/careers', 'src-company-site-acme');
  placement.run('site:good.com', 'good', 'https://good.com/jobs', 'src-company-site-good');
  return db;
}

function runAll(prune: CareersPrune) {
  for (;;) {
    const report = prune.step();
    if (report.done) return report;
  }
}

describe('B643 careers prune pass', () => {
  it('clears the bad careers page, marks its site placement gone and records why', () => {
    const db = openDb();
    const report = runAll(new CareersPrune(db, { chunk: 1, now: () => NOW }));
    expect(report.droppedTotal).toBe(1);
    const acme = db.prepare(`SELECT careers_url, evidence FROM company_directory WHERE company_key = 'acme'`).get() as { careers_url: string | null; evidence: string };
    expect(acme.careers_url).toBeNull();
    const evidence = JSON.parse(acme.evidence);
    expect(evidence.careersUrlDropped).toEqual({ value: 'https://acme.com/careers', how: expect.stringMatching(/HTTP 403.*2026-11-11/) });
    expect(evidence.careersUrl).toBeUndefined();
    expect(db.prepare(`SELECT placement_id, health FROM company_placement ORDER BY placement_id`).all())
      .toEqual([{ placement_id: 'site:acme.com', health: 'gone' }, { placement_id: 'site:good.com', health: null }]);
    expect(db.prepare(`SELECT careers_url FROM company_directory WHERE company_key = 'good'`).get()).toEqual({ careers_url: 'https://good.com/jobs' });
    expect(db.prepare(`SELECT careers_url FROM company_directory WHERE company_key = 'legacy'`).get()).toEqual({ careers_url: 'https://legacy.com/careers' });
  });

  it('finishes an empty pass when the poll state table is not there yet', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(COMPANY_DIRECTORY_MIGRATION);
    db.exec('ALTER TABLE company_directory ADD COLUMN evidence TEXT');
    expect(new CareersPrune(db, { now: () => NOW }).step()).toMatchObject({ done: true, processed: 0 });
  });

  it('changes nothing on a second pass', () => {
    const db = openDb();
    runAll(new CareersPrune(db, { now: () => NOW }));
    const before = db.prepare('SELECT * FROM company_directory ORDER BY company_key').all();
    expect(runAll(new CareersPrune(db, { now: () => NOW })).droppedTotal).toBe(0);
    expect(db.prepare('SELECT * FROM company_directory ORDER BY company_key').all()).toEqual(before);
  });
});

describe('B643 careers prune ticker', () => {
  it('pauses after a finished pass', () => {
    let clock = 0;
    let steps = 0;
    const ticker = new CareersPruneTicker({ step: () => { steps += 1; return { done: true, processed: 0, dropped: 0, droppedTotal: 0, ms: 0 }; } }, () => clock);
    expect(ticker.tick()).toBeDefined();
    expect(ticker.tick()).toBeUndefined();
    clock += 7 * 60 * 60_000;
    expect(ticker.tick()).toBeDefined();
    expect(steps).toBe(2);
  });
});
