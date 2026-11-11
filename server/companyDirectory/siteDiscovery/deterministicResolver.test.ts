import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { COMPANY_DIRECTORY_MIGRATION } from '../../data/companyDirectorySchema';
import { PLACEMENT_TABLES } from '../placement/placementSchema';
import { nameSlugs, resolveCompany } from './deterministicResolver';
import { readPendingCompanies } from './siteDiscovery';
import { runSiteDiscoveryTick } from './siteDiscoverySchedule';

function fakeFetch(routes: Record<string, [number, string]>, seen: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    const [status, body] = routes[url] ?? [404, ''];
    return { status, ok: status < 400, url, headers: new Headers(), text: async () => body } as Response;
  }) as typeof fetch;
}

const publicHost = async () => true;
const company = (name: string, websiteUrl: string | null = null) =>
  ({ companyKey: name.toLowerCase(), companyName: name, websiteUrl, linkedinUrl: null });

describe('B643-9 name slugs', () => {
  it('joins and hyphenates the name without legal suffixes', () => {
    expect(nameSlugs('Acme Robotics GmbH')).toEqual(['acmerobotics', 'acme-robotics']);
    expect(nameSlugs('Stripe, Inc.')).toEqual(['stripe']);
  });
  it('gives no guess for short or generic names', () => {
    expect(nameSlugs('AB')).toEqual([]);
    expect(nameSlugs('Group')).toEqual([]);
  });
});

describe('B643-9 deterministic resolver', () => {
  it('reads the board from the careers page of the known site', async () => {
    const careers = `<html>${'x'.repeat(600)}<a href="https://jobs.lever.co/acme">jobs</a></html>`;
    const found = await resolveCompany(company('Acme', 'https://acme.com/'), fakeFetch({
      'https://acme.com/': [200, '<html>home</html>'],
      'https://acme.com/careers': [200, careers],
      'https://api.lever.co/v0/postings/acme?mode=json&limit=200': [200, '[{}]'],
    }), '2026-11-11', publicHost);
    expect(found).toMatchObject({ careersUrl: 'https://acme.com/careers', board: { provider: 'lever', slug: 'acme', jobs: 1 } });
    expect(JSON.stringify(found.evidence)).toContain('B643-9');
  });

  it('falls back to a name slug guess checked by the board API', async () => {
    const found = await resolveCompany(company('Northwind Labs'), fakeFetch({
      'https://api.ashbyhq.com/posting-api/job-board/northwindlabs': [200, '{"jobs":[{},{}]}'],
    }), '2026-11-11', publicHost);
    expect(found.board).toEqual({ provider: 'ashby', slug: 'northwindlabs', jobs: 2 });
    expect(found.evidence.ats).toMatchObject({ how: expect.stringContaining('name slug') });
  });

  it('holds a name slug that answers at two providers as ambiguous', async () => {
    const found = await resolveCompany(company('Northwind Labs'), fakeFetch({
      'https://api.ashbyhq.com/posting-api/job-board/northwindlabs': [200, '{"jobs":[{}]}'],
      'https://api.lever.co/v0/postings/northwindlabs?mode=json&limit=200': [200, '[{}]'],
    }), '2026-11-11', publicHost);
    expect(found.board).toBeUndefined();
    expect(found.evidence.atsAmbiguous).toBeDefined();
  });

  it('writes nothing for a company nobody answers for', async () => {
    const found = await resolveCompany(company('Ghost Co'), fakeFetch({}), '2026-11-11', publicHost);
    expect(found.board).toBeUndefined();
    expect(found.careersUrl).toBeUndefined();
  });
});

describe('B643-9 dns check is never skipped', () => {
  it('refuses a site whose host resolves privately, whatever fetch is used', async () => {
    const seen: string[] = [];
    const found = await resolveCompany(company('Acme', 'https://acme.com/'), fakeFetch({ 'https://acme.com/': [200, 'x'] }, seen), '2026-11-11', async () => false);
    expect(seen.filter((u) => u.startsWith('https://acme.com'))).toEqual([]);
    expect(found.careersUrl).toBeUndefined();
  });
});

describe('B643-9 tick without a model', () => {
  it('checks pending companies and marks them done', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(COMPANY_DIRECTORY_MIGRATION);
    db.exec('ALTER TABLE company_directory ADD COLUMN evidence TEXT');
    db.exec(PLACEMENT_TABLES);
    db.prepare(`INSERT INTO company_directory (company_key, company_name, source_type, created_at, updated_at)
      VALUES ('northwind', 'Northwind Labs', 'linkedin_guest', '2026-11-09', '2026-11-09')`).run();
    const result = await runSiteDiscoveryTick(db, fakeFetch({
      'https://boards-api.greenhouse.io/v1/boards/northwindlabs/jobs': [200, '{"jobs":[{}]}'],
    }), new Date('2026-11-11T00:00:00Z'), undefined, publicHost);
    expect(result).toEqual({ checked: 1, boards: 1, ambiguous: 0 });
    expect(db.prepare("SELECT ats_provider, ats_slug FROM company_directory").get()).toEqual({ ats_provider: 'greenhouse', ats_slug: 'northwindlabs' });
    expect(readPendingCompanies(db, 10)).toEqual([]);
  });
});
