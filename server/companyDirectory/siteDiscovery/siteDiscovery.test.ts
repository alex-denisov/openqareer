import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { COMPANY_DIRECTORY_MIGRATION } from '../../data/companyDirectorySchema';
import { boardsFromHtml, countJobs } from './atsBoards';
import { parseModelAnswer, readPendingCompanies } from './siteDiscovery';
import { runSiteDiscoveryTick } from './siteDiscoverySchedule';

function directory(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(COMPANY_DIRECTORY_MIGRATION);
  db.exec('ALTER TABLE company_directory ADD COLUMN evidence TEXT');
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

function fakeFetch(routes: Record<string, [number, string]>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const [status, body] = routes[url] ?? [404, ''];
    return { status, ok: status < 400, url, headers: new Headers(), text: async () => body } as Response;
  }) as typeof fetch;
}

describe('B627 site discovery', () => {
  it('finds boards linked from page html', () => {
    const html = '<a href="https://jobs.lever.co/acme">x</a><script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>';
    expect(boardsFromHtml(html)).toEqual([
      { provider: 'greenhouse', slug: 'acme' },
      { provider: 'lever', slug: 'acme' },
    ]);
  });

  it('counts jobs per provider shape', () => {
    expect(countJobs('greenhouse', '{"jobs":[1,2]}')).toBe(2);
    expect(countJobs('lever', '[1]')).toBe(1);
    expect(countJobs('smartrecruiters', '{"totalFound":7}')).toBe(7);
    expect(countJobs('ashby', 'not json')).toBe(-1);
  });

  it('parses only a valid json array from the model', () => {
    expect(parseModelAnswer('sure: [{"key":"a","website":"a.com"}]')).toHaveLength(1);
    expect(parseModelAnswer('no idea')).toEqual([]);
  });

  it('writes only what answers over http and marks the company checked', async () => {
    const db = directory();
    const careers = `<html>${'x'.repeat(600)}<a href="https://jobs.ashbyhq.com/acme">jobs</a></html>`;
    const fetchImpl = fakeFetch({
      'https://acme.com/': [200, '<html>home</html>'],
      'https://acme.com/careers': [200, careers],
      'https://api.ashbyhq.com/posting-api/job-board/acme': [200, '{"jobs":[{},{},{}]}'],
      'https://boards-api.greenhouse.io/v1/boards/acme-wrong/jobs': [404, ''],
    });
    const ask = async () => ({ route: 'openrouter' as const, text:
      '[{"key":"acme","website":"acme.com","careers":"https://acme.com/careers","ats":"greenhouse","slug":"acme-wrong"},{"key":"ghost","website":"ghost.invalid"}]' });
    const result = await runSiteDiscoveryTick(db, ask, fetchImpl, new Date('2026-11-09T12:00:00Z'));
    expect(result).toEqual({ checked: 2, boards: 1, vertex: 0, openrouter: 1 });
    const acme = db.prepare("SELECT * FROM company_directory WHERE company_key = 'acme'").get() as Record<string, string>;
    expect(acme).toMatchObject({
      website_url: 'https://acme.com/',
      careers_url: 'https://acme.com/careers',
      ats_provider: 'ashby',
      ats_slug: 'acme',
      source_type: 'ats_direct',
    });
    const ghost = db.prepare("SELECT * FROM company_directory WHERE company_key = 'ghost'").get() as Record<string, string | null>;
    expect(ghost.website_url).toBeNull();
    expect(ghost.source_type).toBe('linkedin_guest');
    expect(readPendingCompanies(db, 10)).toEqual([]);
  });
});

describe('B627 pending companies', () => {
  it('skips companies whose site came from freehire', () => {
    expect(readPendingCompanies(withFreehire(), 10).map((c) => c.companyKey)).toEqual(['acme']);
  });
});

describe('B627 model URLs', () => {
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
