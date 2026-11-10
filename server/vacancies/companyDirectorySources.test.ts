import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  planCompanyChannels,
  readDirectoryCompanies,
  type DirectoryCompany,
} from './companyDirectorySources';
import type { RegisteredVacancySource } from './defaultVacancySources';

function source(over: Partial<RegisteredVacancySource>): RegisteredVacancySource {
  return {
    id: 'src-x',
    name: 'X',
    type: 'json_api',
    accessClass: 'api',
    market: 'm',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://example.com',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
    ...over,
  } as RegisteredVacancySource;
}

function company(over: Partial<DirectoryCompany>): DirectoryCompany {
  return {
    companyKey: 'acme',
    companyName: 'Acme',
    websiteUrl: null,
    careersUrl: null,
    linkedinOrgId: null,
    atsProvider: null,
    atsSlug: null,
    ...over,
  };
}

const REGISTRY = [
  source({ id: 'src-acme', type: 'career_site', targetUrl: 'https://careers.acme.com/jobs' }),
  source({
    id: 'ats-greenhouse-acme',
    targetUrl: 'https://boards-api.greenhouse.io/v1/boards/acme/jobs',
  }),
  source({ id: 'ats-lever-other', targetUrl: 'https://api.lever.co/v0/postings/other' }),
  source({ id: 'src-hh', type: 'hh' as RegisteredVacancySource['type'] }),
];

describe('planCompanyChannels (B622)', () => {
  it('prefers the own career site over the company ATS and LinkedIn', () => {
    const plan = planCompanyChannels(REGISTRY, [
      company({
        websiteUrl: 'https://acme.com',
        atsProvider: 'greenhouse',
        atsSlug: 'acme',
        linkedinOrgId: '42',
      }),
    ]);
    expect(plan.channels).toEqual([
      { companyKey: 'acme', companyName: 'Acme', kind: 'career_site', sourceId: 'src-acme' },
    ]);
  });

  it('uses the company ATS when the careers page lives in the ATS', () => {
    const plan = planCompanyChannels(REGISTRY, [
      company({
        careersUrl: 'https://boards.greenhouse.io/acme',
        atsProvider: 'greenhouse',
        atsSlug: 'acme',
      }),
    ]);
    expect(plan.channels[0]?.kind).toBe('company_ats');
    expect(plan.channels[0]?.sourceId).toBe('ats-greenhouse-acme');
  });

  it('builds a LinkedIn org_id source when there is no site and no ATS', () => {
    const plan = planCompanyChannels(REGISTRY, [
      company({ companyKey: 'solo', companyName: 'Solo', linkedinOrgId: '112516680' }),
    ]);
    const added = plan.sources.find((s) => s.id === 'src-company-li-solo');
    expect(plan.channels[0]?.kind).toBe('linkedin_company');
    expect(added?.linkedinOrgId).toBe('112516680');
    expect(added?.channelTier).toBe(1);
    expect(added?.targetUrl).toContain('f_C=112516680');
    expect(added?.robotsOverride?.grantedBy).toBe('owner');
  });

  it('skips companies with no usable channel and ignores non-numeric org ids', () => {
    const plan = planCompanyChannels(REGISTRY, [company({ linkedinOrgId: 'abc' })]);
    expect(plan.channels).toEqual([]);
  });

  it('tiers the rest: other boards are 2, aggregators 3', () => {
    const plan = planCompanyChannels(REGISTRY, [
      company({ atsProvider: 'greenhouse', atsSlug: 'acme' }),
    ]);
    const tier = (id: string) => plan.sources.find((s) => s.id === id)?.channelTier;
    expect(tier('ats-greenhouse-acme')).toBe(1);
    expect(tier('ats-lever-other')).toBe(2);
    expect(tier('src-acme')).toBe(2);
    expect(tier('src-hh')).toBe(3);
  });

  it('creates an ATS source for a directory board missing from the registry', () => {
    const plan = planCompanyChannels(REGISTRY, [
      company({ companyKey: 'new', companyName: 'New', atsProvider: 'Ashby', atsSlug: 'newco' }),
    ]);
    const added = plan.sources.find((s) => s.id === 'ats-ashby-newco');
    expect(added?.name).toBe('New');
    expect(added?.companyKey).toBe('new');
  });

  it('does not mutate the registry it was given', () => {
    const before = JSON.stringify(REGISTRY);
    planCompanyChannels(REGISTRY, [company({ atsProvider: 'greenhouse', atsSlug: 'acme' })]);
    expect(JSON.stringify(REGISTRY)).toBe(before);
  });
});

describe('readDirectoryCompanies', () => {
  it('returns [] without the table and reads only active rows', () => {
    const db = new DatabaseSync(':memory:');
    expect(readDirectoryCompanies(db)).toEqual([]);
    db.exec(`CREATE TABLE company_directory (company_key TEXT, company_name TEXT, website_url TEXT,
      careers_url TEXT, linkedin_org_id TEXT, ats_provider TEXT, ats_slug TEXT, status TEXT)`);
    db.exec(`INSERT INTO company_directory VALUES
      ('a','A',NULL,NULL,'1',NULL,NULL,'active'), ('b','B',NULL,NULL,'2',NULL,NULL,'dormant')`);
    expect(readDirectoryCompanies(db).map((c) => c.companyKey)).toEqual(['a']);
    db.close();
  });
});

describe('directoryBoard', () => {
  it('reads the board from the careers URL when the ATS fields are empty', async () => {
    const { directoryBoard } = await import('./companyDirectorySources');
    expect(directoryBoard(company({ careersUrl: 'https://apply.workable.com/altoros/' }))).toEqual({
      provider: 'workable',
      board: 'altoros',
    });
    expect(directoryBoard(company({ careersUrl: 'https://acme.com/careers' }))).toBeUndefined();
  });
});

describe('B628 — directory career sites become sources', () => {
  it('builds a career_site source from an own careers URL missing from the registry', () => {
    const plan = planCompanyChannels(REGISTRY, [
      company({
        companyKey: 'globex',
        companyName: 'Globex',
        careersUrl: 'https://careers.globex.io/jobs',
      }),
    ]);
    expect(plan.channels).toEqual([
      expect.objectContaining({
        companyKey: 'globex',
        kind: 'career_site',
        sourceId: 'src-company-site-globex',
      }),
    ]);
    const built = plan.sources.find((s) => s.id === 'src-company-site-globex');
    expect(built).toMatchObject({
      type: 'career_site',
      enabled: true,
      targetUrl: 'https://careers.globex.io/jobs',
      channelTier: 1,
      companyKey: 'globex',
    });
  });

  it('does not build a site source from the bare website URL or an ATS careers URL', () => {
    const plan = planCompanyChannels(REGISTRY, [
      company({ companyKey: 'a', websiteUrl: 'https://a-corp.io' }),
      company({ companyKey: 'b', careersUrl: 'https://www.linkedin.com/company/b/jobs' }),
      company({ companyKey: 'c', careersUrl: 'not a url' }),
    ]);
    expect(plan.sources.some((s) => s.id.startsWith('src-company-site-'))).toBe(false);
  });

  it('reads Pinpoint and Personio boards from the careers URL', () => {
    const plan = planCompanyChannels(REGISTRY, [
      company({ companyKey: 'p1', careersUrl: 'https://acme1.pinpointhq.com/' }),
      company({ companyKey: 'p2', careersUrl: 'https://acme2.jobs.personio.de/' }),
    ]);
    expect(plan.channels.map((c) => c.kind)).toEqual(['company_ats', 'company_ats']);
  });
});

describe('B628 — Workday boards from the directory', () => {
  it('builds a Workday source from tenant/wdN/site', () => {
    const plan = planCompanyChannels(REGISTRY, [
      company({
        companyKey: 'dbs',
        companyName: 'DBS',
        atsProvider: 'workday',
        atsSlug: 'dbs/wd3/DBS_Careers',
      }),
    ]);
    const added = plan.sources.find((s) => s.id === 'ats-workday-dbs');
    expect(added?.targetUrl).toBe(
      'https://dbs.wd3.myworkdayjobs.com/wday/cxs/dbs/DBS_Careers/jobs',
    );
    expect(added?.companyKey).toBe('dbs');
    expect(added?.channelTier).toBe(1);
  });
  it('ignores a Workday slug without a site', () => {
    const plan = planCompanyChannels(REGISTRY, [
      company({ companyKey: 'x', atsProvider: 'workday', atsSlug: 'x.wd3.myworkdayjobs.com' }),
    ]);
    expect(plan.sources.some((s) => s.id.startsWith('ats-workday-'))).toBe(false);
  });
});
