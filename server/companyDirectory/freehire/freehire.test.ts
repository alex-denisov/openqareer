import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { COMPANY_DIRECTORY_MIGRATION } from '../../data/companyDirectorySchema';
import { FreehireClient } from './freehireClient';
import { boardFromJobUrl, cleanWebsite, disableAggregatorBoards, importCompany, loadDirectoryIndex, nameKey } from './freehireImport';
import { readTotals, runFreehireTick } from './freehireSchedule';

function directory(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(COMPANY_DIRECTORY_MIGRATION);
  db.exec('ALTER TABLE company_directory ADD COLUMN evidence TEXT');
  const insert = db.prepare(
    `INSERT INTO company_directory (company_key, company_name, website_url, source_type, created_at, updated_at)
     VALUES (?, ?, ?, 'linkedin_guest', '2026-11-09', '2026-11-09')`,
  );
  insert.run('acme-inc', 'Acme Inc.', null);
  insert.run('globex', 'Globex', 'https://www.globex.com/');
  return db;
}

const row = (db: DatabaseSync, key: string) =>
  db.prepare('SELECT * FROM company_directory WHERE company_key = ?').get(key) as Record<string, string | null> | undefined;

const job = (url: string) => ({ source: 'x', url });
const now = new Date('2026-11-10T08:00:00Z');

describe('B641 freehire import', () => {
  it('reads boards from job links', () => {
    expect(boardFromJobUrl('https://job-boards.greenhouse.io/agoda/jobs/8364909?utm_source=freehire.me')).toEqual({ provider: 'greenhouse', slug: 'agoda' });
    expect(boardFromJobUrl('https://jobs.lever.co/Plaid/abc')).toEqual({ provider: 'lever', slug: 'plaid' });
    expect(boardFromJobUrl('https://ebay.wd5.myworkdayjobs.com/en-US/apply/job/x')).toEqual({ provider: 'workday', slug: 'ebay/wd5/apply' });
    expect(boardFromJobUrl('https://apply.workable.com/j/ABC')).toBeNull();
    expect(boardFromJobUrl('https://example.com/careers/1')).toBeNull();
  });

  it('keeps only public company sites', () => {
    expect(cleanWebsite('agoda.com')).toBe('https://agoda.com/');
    expect(cleanWebsite('https://www.linkedin.com/company/x')).toBeNull();
    expect(cleanWebsite('http://localhost/')).toBeNull();
    expect(nameKey('Acme Inc.')).toBe('acme');
  });

  it('fills the existing row by name and adds a new one with a checked board', async () => {
    const db = directory();
    const index = loadDirectoryIndex(db);
    const check = async () => 12;
    const existing = await importCompany(db, index, { slug: 'acme', name: 'ACME', website: 'https://acme.io', jobs: [job('https://jobs.ashbyhq.com/acme/1')] }, check, now);
    expect(existing).toMatchObject({ companyKey: 'acme-inc', isNew: false, websiteAdded: true, board: { provider: 'ashby' } });
    expect(row(db, 'acme-inc')).toMatchObject({ website_url: 'https://acme.io/', ats_provider: 'ashby', source_type: 'ats_direct' });
    expect(row(db, 'acme-inc')?.evidence).toContain('freehire');

    const byDomain = await importCompany(db, index, { slug: 'globex-corp', name: 'Globex Corporation', website: 'globex.com', jobs: [] }, check, now);
    expect(byDomain).toMatchObject({ companyKey: 'globex', isNew: false, websiteAdded: false, board: null });

    const fresh = await importCompany(db, index, { slug: 'agoda', name: 'Agoda', website: null, jobs: [job('https://job-boards.greenhouse.io/agoda/jobs/1')] }, check, now);
    expect(fresh).toMatchObject({ isNew: true, board: { provider: 'greenhouse', slug: 'agoda' } });
    expect(row(db, 'agoda')).toMatchObject({ source_type: 'ats_direct', website_url: null });
  });

  it('keeps job aggregators out and puts imported ones to sleep', async () => {
    const db = directory();
    const index = loadDirectoryIndex(db);
    expect(await importCompany(db, index, { slug: 'jobgether', name: 'Jobgether', website: null, jobs: [job('https://jobs.lever.co/jobgether/1')] }, async () => 4010, now)).toBeNull();
    db.prepare(`INSERT INTO company_directory (company_key, company_name, source_type, ats_provider, ats_slug, status, created_at, updated_at, evidence)
      VALUES ('workster-jobs', 'Workster Jobs', 'ats_direct', 'teamtailor', 'worksterjobs', 'active', 'x', 'x', '{"freehire":{"value":"workster-jobs"}}'),
             ('bertelsmann-jobs', 'Bertelsmann-Jobs', 'ats_direct', 'smartrecruiters', 'bertelsmann-jobs', 'active', 'x', 'x', '{"freehire":{"value":"b"}}')`).run();
    expect(disableAggregatorBoards(db, now)).toBe(1);
    expect(row(db, 'workster-jobs')?.status).toBe('dormant');
    expect(row(db, 'bertelsmann-jobs')?.status).toBe('active');
  });

  it('skips job hosts posing as companies', async () => {
    const db = directory();
    const index = loadDirectoryIndex(db);
    expect(await importCompany(db, index, { slug: 'jobs-compassgroupcareers-com', name: 'jobs.compassgroupcareers.com', website: null, jobs: [] }, async () => 1, now)).toBeNull();
  });

  it('rejects a foreign or dead board and keeps the company without it', async () => {
    const db = directory();
    const index = loadDirectoryIndex(db);
    const foreign = await importCompany(db, index, { slug: 'nebius', name: 'Nebius', website: 'https://nebius.com', jobs: [job('https://jobs.lever.co/tripleten/1')] }, async () => 5, now);
    expect(foreign).toMatchObject({ isNew: true, board: null });
    expect(row(db, 'nebius')?.source_type).toBe('corporate_portal');
    const dead = await importCompany(db, index, { slug: 'initech', name: 'Initech', website: null, jobs: [job('https://jobs.lever.co/initech/1')] }, async () => -1, now);
    expect(dead).toMatchObject({ isNew: true, board: null });
    expect(row(db, 'initech')?.source_type).toBe('linkedin_guest');
  });

  it('skips a card that keeps failing and moves on', async () => {
    const db = directory();
    const fetchImpl = (async (input: string | URL | Request) =>
      String(input).includes('/companies?')
        ? Response.json({ data: [{ slug: 'broken', name: 'Broken', job_count: 9 }], meta: { total: 1 } })
        : new Response('', { status: 503 })) as typeof fetch;
    const client = new FreehireClient(fetchImpl, async () => {}, () => 0);
    expect((await runFreehireTick(db, client, async () => 1, 100, () => now)).totals).toMatchObject({ offset: 1, failed: 1, added: 0 });
  });

  it('pages through companies, keeps the offset and slows down on 429', async () => {
    const db = directory();
    let calls = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      calls += 1;
      if (calls === 1) return new Response('', { status: 429 });
      if (url.includes('/companies?')) return Response.json({ data: [{ slug: 'agoda', name: 'Agoda', job_count: 214 }], meta: { total: 1 } });
      return Response.json({ data: { company: { name: 'Agoda', company_info: { website: 'https://agoda.com' } }, jobs: [job('https://job-boards.greenhouse.io/agoda/jobs/1')] } });
    }) as typeof fetch;
    const client = new FreehireClient(fetchImpl, async () => {}, () => 0);
    const result = await runFreehireTick(db, client, async () => 3, 100, () => now);
    expect(result.read).toBe(1);
    expect(client.currentGapMs).toBeGreaterThan(500);
    expect(readTotals(db)).toMatchObject({ offset: 1, read: 1, added: 1, websites: 1, boards: { greenhouse: 1 } });
    expect((await runFreehireTick(db, client, async () => 3, 1, () => now)).read).toBe(0);
  });
});
