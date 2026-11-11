import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { COMPANY_DIRECTORY_MIGRATION } from '../../data/companyDirectorySchema';
import { PLACEMENT_TABLES } from '../placement/placementSchema';
import { boardsFromHtml, countJobs } from './atsBoards';
import { readPendingCompanies, writeDiscovery } from './siteDiscovery';

function directory(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(COMPANY_DIRECTORY_MIGRATION);
  db.exec('ALTER TABLE company_directory ADD COLUMN evidence TEXT');
  db.exec(PLACEMENT_TABLES);
  const insert = db.prepare(
    `INSERT INTO company_directory (company_key, company_name, careers_url, source_type, created_at, updated_at)
     VALUES (?, ?, ?, 'linkedin_guest', '2026-11-09', '2026-11-09')`,
  );
  insert.run('acme', 'Acme', 'https://www.linkedin.com/company/acme/jobs/');
  insert.run('ghost', 'Ghost Co', null);
  return db;
}

function withFreehire(): DatabaseSync {
  const db = directory();
  db.exec(`UPDATE company_directory SET evidence = '{"websiteUrl":{"how":"freehire.me listing"}}' WHERE company_key = 'ghost'`);
  return db;
}

describe('B643 careers url set time', () => {
  it('writeDiscovery records when it sets careers_url, not when it keeps the old one', () => {
    const db = directory();
    db.exec(`UPDATE company_directory SET careers_url = 'https://ghost.co/jobs' WHERE company_key = 'ghost'`);
    const now = '2026-11-12T08:00:00.000Z';
    writeDiscovery(db, { companyKey: 'acme', careersUrl: 'https://acme.com/careers', evidence: {} }, now);
    writeDiscovery(db, { companyKey: 'ghost', careersUrl: 'https://ghost.co/careers', evidence: {} }, now);
    const setAt = (key: string) => (db.prepare(`SELECT json_extract(evidence, '$.careersUrlSetAt') AS at FROM company_directory WHERE company_key = ?`).get(key) as { at: string | null }).at;
    expect(setAt('acme')).toBe(now);
    expect(setAt('ghost')).toBeNull();
  });
});

describe('B627 site discovery', () => {
  it('finds boards linked from page html', () => {
    const html = '<a href="https://jobs.lever.co/acme">x</a><script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>';
    expect(boardsFromHtml(html)).toEqual([
      { provider: 'greenhouse', slug: 'acme' },
      { provider: 'lever', slug: 'acme' },
    ]);
  });

  it('B646 finds boards freehire atsboard recognises for providers we poll', () => {
    const html = [
      'https://acme.bamboohr.com/careers/12',
      'https://acme.teamtailor.com/jobs',
      'https://tt.teamtailor.com/x', // vendor's own "powered by" host, not a tenant
      'https://app.teamtailor.com/login',
      'https://jobs.eu.lever.co/euco/abc',
      'https://jobs.smartrecruiters.com/oneclick-ui/company/Bosch/publication/1',
      'https://www.bamboohr.com/pricing',
    ].join(' ');
    expect(boardsFromHtml(html)).toEqual([
      { provider: 'lever', slug: 'eu-euco' },
      { provider: 'smartrecruiters', slug: 'Bosch' },
      { provider: 'bamboohr', slug: 'acme' },
      { provider: 'teamtailor', slug: 'acme' },
    ]);
  });

  it('B646 counts bamboohr and teamtailor jobs', () => {
    expect(countJobs('bamboohr', '{"result":[1,2,3]}')).toBe(3);
    expect(countJobs('teamtailor', '<rss><item></item><item></item></rss>')).toBe(2);
  });

  it('counts jobs per provider shape', () => {
    expect(countJobs('greenhouse', '{"jobs":[1,2]}')).toBe(2);
    expect(countJobs('lever', '[1]')).toBe(1);
    expect(countJobs('smartrecruiters', '{"totalFound":7}')).toBe(7);
    expect(countJobs('ashby', 'not json')).toBe(-1);
  });

});

describe('B643-9 pending companies', () => {
  it('takes freehire companies too, most pool vacancies first, skips ATS placements and checked ones', () => {
    const db = withFreehire();
    db.prepare(`INSERT INTO vacancy_company VALUES ('v1','ghost','exact_name',1),('v2','ghost','exact_name',1)`).run();
    expect(readPendingCompanies(db, 10).map((c) => c.companyKey)).toEqual(['ghost', 'acme']);
    db.prepare(`INSERT INTO company_placement (placement_id, company_key, type, priority, discovered_by, updated_at) VALUES ('ats:lever:ghost','ghost','ats',2,'source',1)`).run();
    db.prepare(`UPDATE company_directory SET evidence = '{"siteDiscovery":{"how":"B643-9 checked without model"}}' WHERE company_key = 'acme'`).run();
    expect(readPendingCompanies(db, 10)).toEqual([]);
  });
});

describe('B627 candidate URLs', () => {
  it('accepts only public host names', async () => {
    const { isPublicHost } = await import('./siteDiscovery');
    expect(isPublicHost(new URL('https://acme.com/careers'))).toBe(true);
    for (const bad of ['http://127.0.0.1/', 'http://localhost/', 'http://[::1]/', 'https://acme.com:8080/', 'http://db.internal/', 'file:///etc/passwd'])
      expect(isPublicHost(new URL(bad))).toBe(false);
  });
});

describe('B627 dns check', () => {
  it('rejects hosts resolving to private addresses', async () => {
    const { resolvesPublic } = await import('./siteDiscovery');
    const fake = (address: string) => (async () => [{ address, family: 4 }]) as never;
    expect(await resolvesPublic('a.com', fake('93.184.216.34'))).toBe(true);
    expect(await resolvesPublic('a.com', fake('10.0.0.5'))).toBe(false);
    expect(await resolvesPublic('a.com', fake('::ffff:127.0.0.1'))).toBe(false);
  });
});

describe('B643-4 site discovery writes placements', () => {
  it('records the found board and careers site for the company', () => {
    const db = directory();
    writeDiscovery(db, { companyKey: 'acme', websiteUrl: 'https://acme.com', careersUrl: 'https://careers.acme.com/', board: { provider: 'greenhouse', slug: 'acme', jobs: 4 }, evidence: {} }, '2026-11-11T00:00:00Z');
    expect(db.prepare(`SELECT placement_id, company_key, discovered_by FROM company_placement ORDER BY placement_id`).all()).toEqual([
      { placement_id: 'ats:greenhouse:acme', company_key: 'acme', discovered_by: 'site_discovery' },
      { placement_id: 'site:careers.acme.com', company_key: 'acme', discovered_by: 'site_discovery' },
    ]);
  });

  it('records hh employer pages found on the company site', () => {
    const db = directory();
    writeDiscovery(db, { companyKey: 'acme', hhEmployerIds: ['1740'], evidence: {} }, '2026-11-11T00:00:00Z');
    expect(db.prepare(`SELECT placement_id, type, priority FROM company_placement`).all()).toEqual([
      { placement_id: 'hh:1740', type: 'aggregator', priority: 4 },
    ]);
  });
});
