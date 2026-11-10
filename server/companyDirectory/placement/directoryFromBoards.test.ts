import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { adoptBoardCompany, boardCompanyKey } from './directoryFromBoards';

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE company_directory (company_key TEXT PRIMARY KEY, company_name TEXT NOT NULL, website_url TEXT,
      careers_url TEXT, linkedin_url TEXT, linkedin_org_id TEXT, source_type TEXT NOT NULL, ats_provider TEXT, ats_slug TEXT,
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, evidence TEXT);
    CREATE TABLE vacancy_pool_index (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, expired INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE vacancy_cluster_input (id TEXT PRIMARY KEY, cluster_json TEXT NOT NULL);`);
  const index = db.prepare('INSERT INTO vacancy_pool_index (id, source_id) VALUES (?, ?)');
  const input = db.prepare('INSERT INTO vacancy_cluster_input (id, cluster_json) VALUES (?, ?)');
  const add = (id: string, source: string, company: string) => { index.run(id, source); input.run(id, JSON.stringify({ company })); };
  add('a1', 'src-amazon-jobs', 'Amazon');
  add('a2', 'src-amazon-jobs', 'Amazon');
  add('a3', 'src-amazon-jobs', 'Amazon Web Services');
  add('w1', 'ats-workday-capitalone', 'Capital One');
  db.prepare(`INSERT INTO company_directory (company_key, company_name, source_type, created_at, updated_at) VALUES ('capitalone','Other Co','corporate_portal','x','x')`).run();
  return db;
}

describe('boardCompanyKey', () => {
  it('derives a key from the board source id', () => {
    expect(boardCompanyKey('src-amazon-jobs', null)).toBe('amazon');
    expect(boardCompanyKey('src-qualcomm-careers', null)).toBe('qualcomm');
    expect(boardCompanyKey('ats-workday-capitalone', 'capitalone')).toBe('capitalone');
    expect(boardCompanyKey('src-fh-mts', null)).toBe('mts');
  });
});

describe('adoptBoardCompany', () => {
  it('adds the employer with its most frequent vacancy name and no source fields', () => {
    const db = openDb();
    expect(adoptBoardCompany(db, { sourceId: 'src-amazon-jobs', type: 'employer_site', slug: null }, 'T')).toBe('amazon');
    expect(db.prepare(`SELECT company_name, source_type, ats_provider, careers_url, website_url, evidence FROM company_directory WHERE company_key='amazon'`).get())
      .toEqual({ company_name: 'Amazon', source_type: 'corporate_portal', ats_provider: null, careers_url: null, website_url: null,
        evidence: JSON.stringify({ placement: { value: 'src-amazon-jobs', how: 'B643 employer board outside directory' } }) });
  });
  it('does not take over a different company with the same key', () => {
    const db = openDb();
    expect(adoptBoardCompany(db, { sourceId: 'ats-workday-capitalone', type: 'ats', slug: 'capitalone' }, 'T')).toBe('capitalone-workday');
    expect(db.prepare(`SELECT company_name, source_type FROM company_directory WHERE company_key='capitalone-workday'`).get())
      .toEqual({ company_name: 'Capital One', source_type: 'ats_direct' });
  });
  it('skips a board without live vacancies', () => {
    const db = openDb();
    expect(adoptBoardCompany(db, { sourceId: 'ats-lever-ghost', type: 'ats', slug: 'ghost' }, 'T')).toBeNull();
  });
  it('is idempotent', () => {
    const db = openDb();
    adoptBoardCompany(db, { sourceId: 'src-amazon-jobs', type: 'employer_site', slug: null }, 'T');
    expect(adoptBoardCompany(db, { sourceId: 'src-amazon-jobs', type: 'employer_site', slug: null }, 'T2')).toBe('amazon');
    expect(db.prepare('SELECT count(*) n FROM company_directory').get()).toEqual({ n: 2 });
  });
});
