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

describe('B643-9 careers link from the home page', () => {
  it('follows a careers link of the same site and reads the widget board there', async () => {
    const careers = `<html>${'x'.repeat(600)}<script src="https://subscriptions.smartrecruiters.com/widget/v1/sr-job-alerts.js?dcr_ci=SmithsGroup2"></script></html>`;
    const found = await resolveCompany(company('Smiths Group', 'https://www.smiths.com/'), fakeFetch({
      'https://www.smiths.com/': [200, '<a href="/about/careers">Careers</a><a href="https://evil.example/jobs">x</a>'],
      'https://www.smiths.com/about/careers': [200, careers],
      'https://api.smartrecruiters.com/v1/companies/SmithsGroup2/postings?limit=10': [200, '{"totalFound":544}'],
    }), '2026-11-11', publicHost);
    expect(found).toMatchObject({ careersUrl: 'https://www.smiths.com/about/careers', board: { provider: 'smartrecruiters', slug: 'SmithsGroup2', jobs: 544 } });
  });

  it('skips news articles and words that only contain a careers word', async () => {
    const { careersLinks } = await import('./deterministicResolver');
    const html = '<a href="/news/members/v-krae-razrabotayut-model/">В крае разработают модель</a><a href="/program?utm=1">Работа мечты</a><a href="/Article/6289/zarabatiyvaj">Зарабатывай</a><a href="/vacansii">Вакансии</a>';
    expect(careersLinks(html, 'https://asros.ru/')).toEqual(['https://asros.ru/vacansii']);
  });

  it('accepts a jobs subdomain of the same domain but not another site', async () => {
    const { careersLinks } = await import('./deterministicResolver');
    expect(careersLinks('<a href="https://job.sulpak.kz">Вакансии</a><a href="https://jobs.other.com/x">jobs</a><a href="/career/">Карьера</a>', 'https://www.sulpak.kz/'))
      .toEqual(['https://job.sulpak.kz/', 'https://www.sulpak.kz/career/']);
  });
});

describe('B643 careers page must look like vacancies', () => {
  it('does not keep a product page or a 404 page as the careers page', async () => {
    const found = await resolveCompany(company('Sklad', 'https://sklad.ru/'), fakeFetch({
      'https://sklad.ru/': [200, '<a href="/konteynery/vakansii-dlya-kontejnera/">Вакансии</a>'],
      'https://sklad.ru/konteynery/vakansii-dlya-kontejnera/': [200, `<title>Контейнер ПБК-6</title><h1>Контейнер</h1>${'x'.repeat(600)}`],
      'https://sklad.ru/careers': [200, `<title>Страница не найдена</title>${'x'.repeat(600)}`],
      'https://sklad.ru/jobs': [200, `<title>Вакансии</title><h1>Работа у нас</h1>${'x'.repeat(600)}`],
    }), '2026-11-11', publicHost);
    expect(found.careersUrl).toBe('https://sklad.ru/jobs');
  });

  it('skips a careers page the directory dropped before', async () => {
    const seen: string[] = [];
    const found = await resolveCompany({ ...company('Acme', 'https://acme.com/'), droppedCareersUrl: 'https://acme.com/careers' }, fakeFetch({
      'https://acme.com/': [200, '<html>home</html>'],
      'https://acme.com/careers': [200, `<title>Careers</title>${'x'.repeat(600)}`],
    }, seen), '2026-11-11', publicHost);
    expect(found.careersUrl).toBeUndefined();
    expect(seen).not.toContain('https://acme.com/careers');
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
