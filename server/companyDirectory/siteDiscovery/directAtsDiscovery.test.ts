import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { COMPANY_DIRECTORY_MIGRATION } from '../../data/companyDirectorySchema';
import { PLACEMENT_TABLES } from '../placement/placementSchema';
import { DirectAtsDiscovery, directBoard } from './directAtsDiscovery';
import { PendingQueue, runSiteDiscoveryTick } from './siteDiscoverySchedule';

it('keeps the provider instance and case from the original link', () => {
  expect(directBoard('https://jobs.eu.lever.co/acme/123', 'career_ops')).toMatchObject({ provider: 'lever', board: 'eu-acme' });
  expect(directBoard('https://jobs.lever.co/acme/123', 'career_ops')).toMatchObject({ provider: 'lever', board: 'acme' });
  expect(directBoard('https://jobs.ashbyhq.com/AcmeHQ/123', 'freehire')).toMatchObject({ provider: 'ashby', board: 'AcmeHQ' });
  expect(directBoard('https://acme.wd5.myworkdayjobs.com/en-US/ExternalCareers/job/123', 'freehire'))
    .toMatchObject({ provider: 'workday', board: 'acme/wd5/ExternalCareers' });
  for (const url of [
    'https://job-boards.eu.greenhouse.io/acme/123',
    'https://notacme.test/?next=https://jobs.lever.co/acme',
    'https://constructor/acme',
    'https://www.bamboohr.com/careers',
    'https://jobs.lever.co/eu-acme/123',
  ]) expect(directBoard(url, 'freehire')).toBeUndefined();
});

it('checks direct links before web search and stages the result for profile review', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(COMPANY_DIRECTORY_MIGRATION);
  db.exec('ALTER TABLE company_directory ADD COLUMN evidence TEXT');
  db.exec(PLACEMENT_TABLES);
  const add = db.prepare(`INSERT INTO company_directory (
    company_key, company_name, website_url, source_type, evidence, created_at, updated_at
  ) VALUES (?, ?, ?, 'linkedin_guest', ?, '2026-11-09', '2026-11-09')`);
  add.run('alpha', '1Password', 'https://1password.com/', null);
  add.run('beta', 'Beta', null, '{"freehire":{"value":"beta"},"siteDiscovery":{"how":"B643-9"}}');
  add.run('z', 'Z Inc', 'https://z.example/', null);
  db.prepare("INSERT INTO vacancy_company VALUES ('v1','z','exact_name',1)").run();
  db.exec('CREATE TABLE freehire_company_source_candidates (slug TEXT PRIMARY KEY, evidence TEXT, fetched_at TEXT)');
  db.prepare("INSERT INTO freehire_company_source_candidates VALUES ('beta', ?, '2026-11-15')").run(JSON.stringify({
    boards: [{ provider: 'lever', slug: 'beta' }],
    jobs: [{ url: 'https://jobs.eu.lever.co/Beta/1' }, { url: 'https://jobs.eu.lever.co/Beta/2' }],
  }));
  const count = vi.fn(async () => 3);
  const direct = new DirectAtsDiscovery(db, count);
  const now = new Date('2026-11-15T18:00:00Z');
  const queue = new PendingQueue(db, () => now.getTime(), direct);
  const prioritized = await queue.next(2);
  expect(prioritized.map(c => c.companyKey)).toEqual(['alpha', 'beta']);
  const fetchImpl = vi.fn<typeof fetch>();
  const result = await runSiteDiscoveryTick(db, fetchImpl, now, { next: async () => prioritized }, undefined, direct);
  expect(result).toMatchObject({ checked: 2, directChecks: 2, liveDirectBoards: 2 });
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(count.mock.calls).toEqual([['ashby', '1password'], ['lever', 'eu-Beta']]);
  expect(db.prepare('SELECT count(*) AS live FROM company_direct_ats_check WHERE jobs > 0').get()).toEqual({ live: 2 });
  expect(db.prepare('SELECT count(*) AS sources FROM company_directory WHERE ats_provider IS NOT NULL').get()).toEqual({ sources: 0 });
  expect(db.prepare('SELECT count(*) AS placements FROM company_placement').get()).toEqual({ placements: 0 });
  expect((await new PendingQueue(db, () => now.getTime(), direct).next(3)).map(c => c.companyKey)).toEqual(['z']);
  db.close();
});
