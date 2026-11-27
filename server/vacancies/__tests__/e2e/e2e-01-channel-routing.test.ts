import { afterEach, describe, expect, it } from 'vitest';
import {
  directoryBoard,
  planCompanyChannels,
  readDirectoryCompanies,
  type DirectoryCompany,
} from '../../companyDirectorySources';
import { registryWithCompanyChannels } from '../../composeVacancyEngine';
import { DEFAULT_VACANCY_SOURCES } from '../../defaultVacancySources';
import {
  cleanupAllSqliteHarnesses,
  createMemoryDb,
  createTempDbWorkspace,
  seedDirectoryCompany,
  seedPlacement,
  seedSourceState,
} from './helpers/sqliteHarness';
import { bootstrapPoolTables } from './helpers/sqliteHarness';

afterEach(() => {
  cleanupAllSqliteHarnesses();
});

function makeCompany(overrides: Partial<DirectoryCompany> & { companyKey: string }): DirectoryCompany {
  return {
    companyName: overrides.companyName ?? overrides.companyKey,
    websiteUrl: null,
    careersUrl: null,
    linkedinOrgId: null,
    atsProvider: null,
    atsSlug: null,
    ...overrides,
  };
}

describe('E2E-1: Channel Priority & Immediate Dead/0-Item Fallback (F2, F3)', () => {
  // Tier 1 (Happy-Path)
  it('T1.1 ranks company_ats as tier 1 over career_site when a company has both', () => {
    const plan = planCompanyChannels(DEFAULT_VACANCY_SOURCES, [
      makeCompany({
        companyKey: 'core42',
        companyName: 'Core42',
        websiteUrl: 'https://www.core42.ai/',
        careersUrl: 'https://www.core42.ai/careers',
        atsProvider: 'greenhouse',
        atsSlug: 'core42-board',
        linkedinOrgId: '20800',
      }),
    ]);

    const channel = plan.channels.find((c) => c.companyKey === 'core42');
    expect(channel?.kind).toBe('company_ats');
    expect(channel?.sourceId).toBe('ats-greenhouse-core42-board');
    const source = plan.sources.find((s) => s.id === 'ats-greenhouse-core42-board');
    expect(source?.channelTier).toBe(1);
  });

  it('T1.2 ranks career_site as tier 1 over linkedin_company when no ATS exists', () => {
    const plan = planCompanyChannels(DEFAULT_VACANCY_SOURCES, [
      makeCompany({
        companyKey: 'own-site-co',
        companyName: 'OwnSite Co',
        websiteUrl: 'https://ownsite.example/',
        careersUrl: 'https://ownsite.example/careers',
        linkedinOrgId: '998877',
      }),
    ]);

    const channel = plan.channels.find((c) => c.companyKey === 'own-site-co');
    expect(channel?.kind).toBe('career_site');
    expect(channel?.sourceId).toBe('src-company-site-own-site-co');
  });

  it('T1.3 selects linkedin_company as tier 1 when neither ATS nor careers_url exists', () => {
    const plan = planCompanyChannels(DEFAULT_VACANCY_SOURCES, [
      makeCompany({
        companyKey: 'li-only-co',
        companyName: 'LI Only Co',
        websiteUrl: 'https://lionly.example/',
        linkedinOrgId: '14598162',
      }),
    ]);

    const channel = plan.channels.find((c) => c.companyKey === 'li-only-co');
    expect(channel?.kind).toBe('linkedin_company');
    expect(channel?.sourceId).toBe('src-company-li-li-only-co');
  });

  it('T1.4 expanded ATS_HOSTS prevents Wave 1-3 ATS URLs from becoming own career_site', () => {
    const plan = planCompanyChannels(DEFAULT_VACANCY_SOURCES, [
      makeCompany({
        companyKey: 'rippling-co',
        companyName: 'Rippling Co',
        careersUrl: 'https://ats.rippling.com/rippling-co/jobs',
        linkedinOrgId: '551122',
      }),
      makeCompany({
        companyKey: 'jazz-co',
        companyName: 'Jazz Co',
        careersUrl: 'https://jazz-co.applytojob.com/apply',
        linkedinOrgId: '551123',
      }),
    ]);

    expect(plan.sources.find((s) => s.id === 'src-company-site-rippling-co')).toBeUndefined();
    expect(plan.sources.find((s) => s.id === 'src-company-site-jazz-co')).toBeUndefined();
  });

  it('T1.5 directoryBoard extracts provider and board from Wave 1-3 and standard careersUrl', () => {
    expect(
      directoryBoard(
        makeCompany({
          companyKey: 'gh-co',
          careersUrl: 'https://job-boards.eu.greenhouse.io/gh-eu-board',
        }),
      ),
    ).toEqual({ provider: 'greenhouse', board: 'gh-eu-board' });

    expect(
      directoryBoard(
        makeCompany({
          companyKey: 'rip-co',
          careersUrl: 'https://ats.rippling.com/3msservicesllc/jobs',
        }),
      ),
    ).toEqual({ provider: 'rippling', board: '3msservicesllc' });
  });

  it('T1.6 immediate fallback activates company_ats when src-company-site-* has 0 items and error in DB', () => {
    const ws = createTempDbWorkspace();
    const db = ws.openDb();
    bootstrapPoolTables(db);
    seedDirectoryCompany(db, {
      companyKey: 'broken-site-co',
      companyName: 'BrokenSite Co',
      websiteUrl: 'https://brokensite.example/',
      careersUrl: 'https://brokensite.example/careers',
      atsProvider: 'greenhouse',
      atsSlug: 'brokensite-gh',
      linkedinOrgId: '112233',
    });
    seedSourceState(db, {
      sourceId: 'src-company-site-broken-site-co',
      lastStatus: 'error',
      lastErrorMessage: 'vacancy_source_unreachable: 500',
      itemsFoundTotal: 0,
      itemsActiveTotal: 0,
    });
    db.close();

    const sources = registryWithCompanyChannels(ws.dbPath);
    const siteSrc = sources.find((s) => s.id === 'src-company-site-broken-site-co');
    const atsSrc = sources.find((s) => s.id === 'ats-greenhouse-brokensite-gh');
    expect(siteSrc?.channelTier).not.toBe(1);
    expect(atsSrc?.channelTier).toBe(1);
    expect(atsSrc?.enabled).toBe(true);
  });

  // Tier 2 (Boundary / Corner / Negative)
  it('T2.1 dead 0-item career_site falls back immediately to src-company-li-* without waiting 14d', () => {
    const ws = createTempDbWorkspace();
    const db = ws.openDb();
    bootstrapPoolTables(db);
    seedDirectoryCompany(db, {
      companyKey: 'li-fallback-co',
      companyName: 'LIFallback Co',
      websiteUrl: 'https://lifallback.example/',
      careersUrl: 'https://lifallback.example/careers',
      linkedinOrgId: '445566',
    });
    seedSourceState(db, {
      sourceId: 'src-company-site-li-fallback-co',
      lastStatus: 'error',
      lastErrorMessage: 'vacancy_source_unreachable: 404',
      itemsFoundTotal: 0,
      itemsActiveTotal: 0,
    });
    db.close();

    const sources = registryWithCompanyChannels(ws.dbPath);
    const liSrc = sources.find((s) => s.id === 'src-company-li-li-fallback-co');
    expect(liSrc).toBeDefined();
    expect(liSrc?.channelTier).toBe(1);
  });

  it('T2.2 skips src-company-site-* marked health=gone in company_placement', () => {
    const ws = createTempDbWorkspace();
    const db = ws.openDb();
    bootstrapPoolTables(db);
    seedDirectoryCompany(db, {
      companyKey: 'gone-site-co',
      companyName: 'GoneSite Co',
      careersUrl: 'https://gonesite.example/careers',
      linkedinOrgId: '778899',
    });
    seedPlacement(db, {
      placementId: 'site:gonesite.example',
      companyKey: 'gone-site-co',
      type: 'employer_site',
      url: 'https://gonesite.example/careers',
      sourceId: 'src-company-site-gone-site-co',
      health: 'gone',
    });
    db.close();

    const sources = registryWithCompanyChannels(ws.dbPath);
    const siteSrc = sources.find((s) => s.id === 'src-company-site-gone-site-co');
    const liSrc = sources.find((s) => s.id === 'src-company-li-gone-site-co');
    expect(siteSrc?.channelTier).not.toBe(1);
    expect(liSrc?.channelTier).toBe(1);
  });

  it('T2.3 treats paycom ATS as an enabled primary channel without exclusion', () => {
    const plan = planCompanyChannels(DEFAULT_VACANCY_SOURCES, [
      makeCompany({
        companyKey: 'choc-paycom',
        companyName: 'CHOC',
        atsProvider: 'paycom',
        atsSlug: '0012604c8f3328ef1785c7189f1333b7',
        linkedinOrgId: '334455',
      }),
    ]);

    const channel = plan.channels.find((c) => c.companyKey === 'choc-paycom');
    expect(channel?.kind).toBe('company_ats');
    expect(channel?.sourceId).toBe('ats-paycom-0012604c8f3328ef1785c7189f1333b7');
    const paycom = plan.sources.find((s) => s.id === 'ats-paycom-0012604c8f3328ef1785c7189f1333b7');
    expect(paycom?.enabled).toBe(true);
  });

  it('T2.4 ignores malformed or non-HTTP careersUrl safely without throwing', () => {
    const plan = planCompanyChannels(DEFAULT_VACANCY_SOURCES, [
      makeCompany({
        companyKey: 'bad-url-co',
        companyName: 'BadUrl Co',
        careersUrl: 'javascript:alert(1)',
        websiteUrl: 'not-a-url',
      }),
    ]);

    expect(plan.channels.find((c) => c.companyKey === 'bad-url-co')).toBeUndefined();
    expect(plan.sources.find((s) => s.id === 'src-company-site-bad-url-co')).toBeUndefined();
  });

  it('T2.5 ignores non-numeric linkedinOrgId safely', () => {
    const db = createMemoryDb();
    seedDirectoryCompany(db, {
      companyKey: 'bad-org-co',
      companyName: 'BadOrg Co',
      linkedinOrgId: 'core42ai',
    });
    const companies = readDirectoryCompanies(db);
    const plan = planCompanyChannels(DEFAULT_VACANCY_SOURCES, companies);

    expect(plan.channels.find((c) => c.companyKey === 'bad-org-co')).toBeUndefined();
    expect(plan.sources.find((s) => s.id === 'src-company-li-bad-org-co')).toBeUndefined();
  });

  it('T2.6 deduplicates primary channel when two companies share one ATS board slug', () => {
    const plan = planCompanyChannels(DEFAULT_VACANCY_SOURCES, [
      makeCompany({
        companyKey: 'parent-co',
        companyName: 'Parent Co',
        atsProvider: 'greenhouse',
        atsSlug: 'shared-board',
      }),
      makeCompany({
        companyKey: 'subsidiary-co',
        companyName: 'Subsidiary Co',
        atsProvider: 'greenhouse',
        atsSlug: 'shared-board',
      }),
    ]);

    const matching = plan.channels.filter((c) => c.sourceId === 'ats-greenhouse-shared-board');
    expect(matching).toHaveLength(1);
    expect(matching[0]?.companyKey).toBe('parent-co');
  });
});
