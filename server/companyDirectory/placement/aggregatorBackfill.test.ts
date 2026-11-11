import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { VACANCY_CLUSTER_INPUT_TABLE, VACANCY_POOL_INDEX_TABLE } from '../../data/sqliteSchema';
import { AggregatorCompanyBackfill, AggregatorCompanyTicker } from './aggregatorBackfill';

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE company_directory (company_key TEXT PRIMARY KEY, company_name TEXT NOT NULL,
    website_url TEXT, ats_provider TEXT, ats_slug TEXT);`);
  db.exec(VACANCY_POOL_INDEX_TABLE + VACANCY_CLUSTER_INPUT_TABLE);
  const company = db.prepare('INSERT INTO company_directory (company_key, company_name) VALUES (?, ?)');
  company.run('acme', 'Acme Robotics');
  company.run('yandex', 'Яндекс');
  const row = (id: string, source: string, json: object, expired = 0) => {
    db.prepare(`INSERT INTO vacancy_pool_index (id, source_id, is_active, url, search_text, expired) VALUES (?, ?, 1, 'u', '', ?)`).run(id, source, expired);
    db.prepare('INSERT INTO vacancy_cluster_input (id, cluster_json) VALUES (?, ?)').run(id, JSON.stringify(json));
  };
  row('v1', 'src-remotive', { company: 'Acme Robotics Inc.' });
  row('v2', 'src-hh-search', { company: 'Яндекс' });
  row('v3', 'src-hh-search', { company: 'Яндекс', employerIsPerson: true });
  row('v4', 'ats-greenhouse-acme', { company: 'Acme Robotics' });
  row('v5', 'src-remotive', { company: 'Acme Robotics' }, 1);
  return db;
}

const links = (db: DatabaseSync) => db.prepare('SELECT vacancy_id, company_key, match_how FROM vacancy_company ORDER BY vacancy_id').all();

function runPass(backfill: AggregatorCompanyBackfill) {
  for (let i = 0; i < 50; i++) {
    const report = backfill.step();
    if (report.done) return report;
  }
  throw new Error('pass did not finish');
}

describe('B643-8 aggregator company backfill', () => {
  it('links live aggregator rows and skips boards, individuals and expired rows', () => {
    const db = openDb();
    const report = runPass(new AggregatorCompanyBackfill(db, { chunk: 2 }));
    expect(links(db)).toEqual([
      { vacancy_id: 'v1', company_key: 'acme', match_how: 'exact_name' },
      { vacancy_id: 'v2', company_key: 'yandex', match_how: 'exact_name_single_word' },
    ]);
    expect(report).toMatchObject({ done: true, changedTotal: 2 });
  });

  it('is idempotent and drops a link that no longer holds', () => {
    const db = openDb();
    const backfill = new AggregatorCompanyBackfill(db, { chunk: 10 });
    runPass(backfill);
    db.prepare(`UPDATE vacancy_cluster_input SET cluster_json = '{"company":"Globex"}' WHERE id = 'v1'`).run();
    const changes = db.prepare('SELECT total_changes() AS n').get() as { n: number };
    runPass(backfill);
    const after = db.prepare('SELECT total_changes() AS n').get() as { n: number };
    expect(after.n - changes.n).toBe(1);
    expect(links(db)).toEqual([{ vacancy_id: 'v2', company_key: 'yandex', match_how: 'exact_name_single_word' }]);
  });

  it('pauses after a finished pass', () => {
    let now = 0;
    const step = () => ({ done: true, processed: 0, linked: 0, unlinked: 0, linkedTotal: 0, changedTotal: 0, ms: 0 });
    const ticker = new AggregatorCompanyTicker({ step }, () => now);
    expect(ticker.tick()).toBeDefined();
    now = 60_000;
    expect(ticker.tick()).toBeUndefined();
  });
});
