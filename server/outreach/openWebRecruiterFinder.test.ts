import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteLinkedinPoolRepository } from '../linkedinPool/sqliteLinkedinPoolRepository';
import { FootprintRequestGate } from '../osint/adapters/requestScheduler';
import {
  createCompanySiteFinder,
  createOpenWebRecruiterFinder,
  resolveCompanyDomain,
} from './openWebRecruiterFinder';

const now = new Date('2026-10-26T12:00:00.000Z');
const resources: Array<{ repository: SqliteLinkedinPoolRepository; directory: string }> = [];

afterEach(() => {
  for (const resource of resources.splice(0)) {
    resource.repository.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

function createRepository(): SqliteLinkedinPoolRepository {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-open-web-'));
  const repository = new SqliteLinkedinPoolRepository({
    databasePath: join(directory, 'pool.db'),
    encryptionKey: Buffer.alloc(32, 3),
    runtimeRoot: join(directory, 'runtime'),
    now: () => now,
  });
  resources.push({ repository, directory });
  return repository;
}

const anna = {
  url: 'https://uk.linkedin.com/in/anna-smith-talent',
  title: 'Anna Smith',
  text: '# Anna Smith\nSenior Technical Recruiter at Acme\nLondon, England, United Kingdom (GB)',
};

function exaFetch(results: unknown[]) {
  return vi.fn(async () => new Response(JSON.stringify({ results }), { status: 200 }));
}

describe('open web recruiter finder', () => {
  it('finds a recruiter by public profile search without any LinkedIn account', async () => {
    const repository = createRepository();
    const fetch = exaFetch([anna]);
    const find = createOpenWebRecruiterFinder({
      repository,
      apiKey: 'test-key',
      fetch,
      requestGate: new FootprintRequestGate({ intervalMs: 0 }),
      now: () => now,
    });

    const profile = await find('Acme');

    expect(profile).toMatchObject({
      fullName: 'Anna Smith',
      roleTitle: 'Senior Technical Recruiter at Acme',
      linkedinUrl: 'https://www.linkedin.com/in/anna-smith-talent',
      sourcePlatform: 'company_osint',
      sourceUrl: 'https://www.linkedin.com/in/anna-smith-talent',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reuses the cached result and does not pay for a second search', async () => {
    const repository = createRepository();
    const fetch = exaFetch([anna]);
    const find = createOpenWebRecruiterFinder({
      repository,
      apiKey: 'test-key',
      fetch,
      requestGate: new FootprintRequestGate({ intervalMs: 0 }),
      now: () => now,
    });

    await find('Acme');
    const second = await find('acme');

    expect(second?.fullName).toBe('Anna Smith');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns null without a key and makes no request', async () => {
    const repository = createRepository();
    const fetch = exaFetch([anna]);
    const find = createOpenWebRecruiterFinder({ repository, apiKey: undefined, fetch, now: () => now });

    expect(await find('Acme')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('company domain', () => {
  const mx = (hosts: Record<string, boolean>) =>
    vi.fn(async (domain: string) => (hosts[domain] ? [{ exchange: `mx.${domain}`, priority: 1 }] : []));

  it('ignores applicant tracking hosts and guesses the domain from the name', async () => {
    const resolveMx = mx({ 'jpmorganchase.com': true });
    const domain = await resolveCompanyDomain(
      { id: 'v', company: 'JPMorganChase', url: 'https://jpmorganchase.contacthr.com/153784034' },
      resolveMx,
    );
    expect(domain).toBe('jpmorganchase.com');
  });

  it('does not take a job board host for the company domain', async () => {
    const domain = await resolveCompanyDomain(
      { id: 'v', company: 'Veeva Systems', url: 'https://himalayas.app/companies/veeva/jobs/1' },
      mx({ 'veevasystems.com': true }),
    );
    expect(domain).toBe('veevasystems.com');
  });

  it('keeps a real company site from the vacancy link', async () => {
    const domain = await resolveCompanyDomain(
      { id: 'v', company: 'Acme', url: 'https://careers.acme.io/jobs/1' },
      mx({}),
    );
    expect(domain).toBe('acme.io');
  });

  it('returns undefined when no guessed domain accepts mail', async () => {
    const domain = await resolveCompanyDomain(
      { id: 'v', company: 'Ozon', url: 'https://hh.ru/vacancy/1' },
      mx({}),
    );
    expect(domain).toBeUndefined();
  });
});

describe('company site finder', () => {
  const site = (url: string) => ({ url, title: 'Site', text: '' });

  it('takes the first non-platform site with mail records and caches it', async () => {
    const repository = createRepository();
    const fetch = exaFetch([site('https://www.linkedin.com/company/jpm'), site('https://www.jpmorganchase.com/about')]);
    const resolveMx = vi.fn(async (domain: string) =>
      domain === 'jpmorganchase.com' ? [{ exchange: 'mx', priority: 1 }] : [],
    );
    const findSite = createCompanySiteFinder({
      repository,
      apiKey: 'test-key',
      fetch,
      requestGate: new FootprintRequestGate({ intervalMs: 0 }),
      now: () => now,
      resolveMx,
    });

    expect(await findSite('JPMorganChase')).toBe('jpmorganchase.com');
    expect(await findSite('jpmorganchase')).toBe('jpmorganchase.com');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('searches a Russian company in Russian and prefers its .ru site', async () => {
    const repository = createRepository();
    const fetch = exaFetch([site('https://ancor.org/about'), site('https://www.ancor.ru/')]);
    const findSite = createCompanySiteFinder({
      repository,
      apiKey: 'test-key',
      fetch,
      requestGate: new FootprintRequestGate({ intervalMs: 0 }),
      now: () => now,
      resolveMx: async () => [{ exchange: 'mx', priority: 1 }],
    });

    expect(await findSite('ANCOR', 'ru')).toBe('ancor.ru');
    expect(JSON.stringify(fetch.mock.calls)).toContain('официальный сайт');
  });

  it('treats an hh.ru vacancy as a Russian company', async () => {
    const seen: string[] = [];
    const domain = await resolveCompanyDomain(
      { id: 'v', company: 'ANCOR', url: 'https://hh.ru/vacancy/138649447' },
      async () => [{ exchange: 'mx', priority: 1 }],
      async (_company, market) => {
        seen.push(market ?? 'global');
        return undefined;
      },
    );
    expect(seen).toEqual(['ru']);
    expect(domain).toBe('ancor.ru');
  });

  it('remembers a miss so a company without a site is not searched again', async () => {
    const repository = createRepository();
    const fetch = exaFetch([]);
    const findSite = createCompanySiteFinder({
      repository,
      apiKey: 'test-key',
      fetch,
      requestGate: new FootprintRequestGate({ intervalMs: 0 }),
      now: () => now,
      resolveMx: async () => [],
    });

    expect(await findSite('Nobody Ltd')).toBeUndefined();
    expect(await findSite('Nobody Ltd')).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the found site before guessing from the name', async () => {
    const resolveMx = vi.fn(async (domain: string) => (domain === 'jpmchase.com' ? [{ exchange: 'mx', priority: 1 }] : []));
    const domain = await resolveCompanyDomain(
      { id: 'v', company: 'JPMorganChase', url: 'https://jpmorganchase.contacthr.com/1' },
      resolveMx,
      async () => 'jpmchase.com',
    );
    expect(domain).toBe('jpmchase.com');
  });
});
