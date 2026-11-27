import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  isAtsUnavailable,
  isSiteFallbackWarranted,
  planCompanyChannels,
  readChannelHealthSummary,
  readDirectoryCompanies,
  resolveCompanyChannel,
  type DirectoryCompany,
  type SourceStateSummary,
} from './companyDirectorySources';
import { emptySourceObservations, recordReading } from './sourceHealthVerdict';
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

describe('planCompanyChannels (B622 / Phase 1 F2+F3)', () => {
  it('prefers company ATS over the own career site and LinkedIn', () => {
    const plan = planCompanyChannels(REGISTRY, [
      company({
        websiteUrl: 'https://acme.com',
        atsProvider: 'greenhouse',
        atsSlug: 'acme',
        linkedinOrgId: '42',
      }),
    ]);
    expect(plan.channels).toEqual([
      { companyKey: 'acme', companyName: 'Acme', kind: 'company_ats', sourceId: 'ats-greenhouse-acme' },
    ]);
  });

  it('routes paycom ATS as primary and falls back from closed ATS to career_site or linkedin_company', () => {
    const paycomPlan = planCompanyChannels(REGISTRY, [
      company({
        companyKey: 'paycomco',
        companyName: 'PaycomCo',
        careersUrl: 'https://careers.paycomco.io/jobs',
        atsProvider: 'paycom',
        atsSlug: '0123456789abcdef0123456789abcdef',
        linkedinOrgId: '777',
      }),
    ]);
    expect(paycomPlan.channels).toEqual([
      {
        companyKey: 'paycomco',
        companyName: 'PaycomCo',
        kind: 'company_ats',
        sourceId: 'ats-paycom-0123456789abcdef0123456789abcdef',
      },
    ]);

    const closedAtsFallback = planCompanyChannels(
      REGISTRY,
      [
        company({
          companyKey: 'acme',
          companyName: 'Acme',
          websiteUrl: 'https://acme.com',
          atsProvider: 'greenhouse',
          atsSlug: 'acme',
          linkedinOrgId: '42',
        }),
      ],
      { unavailableAtsSourceIds: new Set(['ats-greenhouse-acme']) },
    );
    expect(closedAtsFallback.channels).toEqual([
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

  it('classifies a Teamtailor careers URL as its ATS board', async () => {
    const { planCompanyChannels } = await import('./companyDirectorySources');
    const plan = planCompanyChannels(REGISTRY, [
      company({
        companyKey: 'agito',
        companyName: 'Agito Sverige AB',
        careersUrl: 'https://agitosverige.teamtailor.com/jobs',
      }),
    ]);
    expect(plan.channels).toEqual([
      expect.objectContaining({
        companyKey: 'agito',
        kind: 'company_ats',
        sourceId: 'ats-teamtailor-agitosverige',
      }),
    ]);
    expect(plan.sources.find((source) => source.id === 'ats-teamtailor-agitosverige')).toBeTruthy();
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

describe('Phase 1 F2 — join.com & paylocity.com recognition', () => {
  it('maps numeric join.com and paylocity.com careers_url to ATS channels and blocks non-numeric join slugs', () => {
    const plan = planCompanyChannels(REGISTRY, [
      company({
        companyKey: 'j1',
        companyName: 'Join Numeric',
        careersUrl: 'https://join.com/companies/167291',
      }),
      company({
        companyKey: 'j2',
        companyName: 'Join Slug',
        careersUrl: 'https://join.com/companies/acme-slug',
      }),
      company({
        companyKey: 'j3',
        companyName: 'Join Explicit Slug',
        atsProvider: 'join',
        atsSlug: 'not-numeric',
        linkedinOrgId: '555',
      }),
      company({
        companyKey: 'p1',
        companyName: 'Paylocity Co',
        careersUrl: 'https://recruiting.paylocity.com/Recruiting/Jobs/All/12345-abcd',
      }),
    ]);

    expect(plan.channels).toEqual([
      { companyKey: 'j1', companyName: 'Join Numeric', kind: 'company_ats', sourceId: 'ats-join-167291' },
      { companyKey: 'j3', companyName: 'Join Explicit Slug', kind: 'linkedin_company', sourceId: 'src-company-li-j3' },
      { companyKey: 'p1', companyName: 'Paylocity Co', kind: 'company_ats', sourceId: 'ats-paylocity-12345-abcd' },
    ]);
    expect(plan.sources.some((s) => s.id === 'src-company-site-j2')).toBe(false);
    expect(plan.sources.some((s) => s.id === 'ats-join-not-numeric')).toBe(false);
  });
});

describe('Phase 1 F3 — immediate site fallback & O(1) channel resolution', () => {
  const NOW = Date.parse('2026-11-27T12:00:00Z');

  it('does not fall back on 1st/2nd error, 1st/2nd empty reading, or HTTP 429', () => {
    const twoErrors = new Map<string, SourceStateSummary>([
      [
        'src-company-site-acme',
        {
          sourceId: 'src-company-site-acme',
          lastStatus: 'error',
          lastErrorMessage: 'vacancy_source_unreachable: 404',
          itemsFoundTotal: 0,
          observations: {
            ...emptySourceObservations(),
            firstReadingAt: '2026-11-25T00:00:00Z',
            lastReadingAt: '2026-11-26T00:00:00Z',
            lastReadingSucceeded: false,
            windowReadings: 2,
            windowSuccessful: 0,
            consecutiveNotFound: 2,
          },
        },
      ],
    ]);
    expect(isSiteFallbackWarranted('src-company-site-acme', 'acme', { sourceStates: twoErrors, nowMs: NOW })).toBe(false);

    const twoEmpty = new Map<string, SourceStateSummary>([
      [
        'src-company-site-acme',
        {
          sourceId: 'src-company-site-acme',
          lastStatus: 'healthy',
          itemsFoundTotal: 0,
          observations: {
            ...emptySourceObservations(),
            firstReadingAt: '2026-11-25T00:00:00Z',
            lastReadingAt: '2026-11-26T00:00:00Z',
            lastReadingSucceeded: true,
            consecutiveEmptyReadings: 2,
          },
        },
      ],
    ]);
    expect(isSiteFallbackWarranted('src-company-site-acme', 'acme', { sourceStates: twoEmpty, nowMs: NOW })).toBe(false);

    const rateLimited = new Map<string, SourceStateSummary>([
      [
        'src-company-site-acme',
        {
          sourceId: 'src-company-site-acme',
          lastStatus: 'error',
          lastErrorMessage: 'vacancy_source_unreachable: 429',
          itemsFoundTotal: 0,
          observations: {
            ...emptySourceObservations(),
            firstReadingAt: '2026-11-20T00:00:00Z',
            lastReadingAt: '2026-11-26T00:00:00Z',
            lastReadingSucceeded: false,
            windowReadings: 5,
            windowSuccessful: 0,
          },
        },
      ],
    ]);
    expect(isSiteFallbackWarranted('src-company-site-acme', 'acme', { sourceStates: rateLimited, nowMs: NOW })).toBe(false);
  });

  it('falls back immediately to linkedin_company on 3 errors, 3 empty readings, disabled, or placement gone', () => {
    const comp = company({
      companyKey: 'globex',
      companyName: 'Globex',
      careersUrl: 'https://careers.globex.io/jobs',
      linkedinOrgId: '987654',
    });

    const threeEmptyObs = [0, 1, 2].reduce(
      (obs, i) =>
        recordReading(obs, {
          succeeded: true,
          census: {
            total: 0,
            fresherThan30Days: 0,
            fresherThan90Days: 0,
            fresherThan180Days: 0,
            withEmployer: 0,
            withLink: 0,
            withDate: 0,
          },
          atMs: NOW - (3 - i) * 3_600_000,
        }),
      emptySourceObservations(),
    );
    const emptyPlan = planCompanyChannels(REGISTRY, [comp], {
      sourceStates: new Map([
        [
          'src-company-site-globex',
          {
            sourceId: 'src-company-site-globex',
            lastStatus: 'healthy',
            itemsFoundTotal: 0,
            observations: threeEmptyObs,
          },
        ],
      ]),
      nowMs: NOW,
    });
    expect(emptyPlan.channels).toEqual([
      { companyKey: 'globex', companyName: 'Globex', kind: 'linkedin_company', sourceId: 'src-company-li-globex' },
    ]);

    const disabledPlan = planCompanyChannels(REGISTRY, [comp], {
      sourceStates: new Map([
        [
          'src-company-site-globex',
          {
            sourceId: 'src-company-site-globex',
            lastStatus: 'disabled',
            lastErrorMessage: 'vacancy_source_unreachable: 404',
            itemsFoundTotal: 0,
          },
        ],
      ]),
      nowMs: NOW,
    });
    expect(disabledPlan.channels[0]?.sourceId).toBe('src-company-li-globex');
  });

  it('retains career_site when no fallback exists and placement is not gone', () => {
    const comp = company({
      companyKey: 'nofallback',
      companyName: 'NoFallback',
      careersUrl: 'https://nofallback.io/careers',
    });
    const plan = planCompanyChannels(REGISTRY, [comp], {
      unhealthySourceIds: new Set(['src-company-site-nofallback']),
    });
    expect(plan.channels[0]?.sourceId).toBe('src-company-site-nofallback');

    const gonePlan = planCompanyChannels(REGISTRY, [comp], {
      goneCompanySiteKeys: new Set(['nofallback']),
    });
    expect(gonePlan.channels).toEqual([]);
  });

  it('streams health summary via readChannelHealthSummary and resolves one company via resolveCompanyChannel', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE company_directory (
        company_key TEXT PRIMARY KEY, company_name TEXT, website_url TEXT,
        careers_url TEXT, linkedin_org_id TEXT, ats_provider TEXT, ats_slug TEXT, status TEXT
      );
      CREATE TABLE vacancy_source_state (
        source_id TEXT PRIMARY KEY, last_sync_at TEXT, last_status TEXT,
        last_error_message TEXT, items_found_total INTEGER NOT NULL DEFAULT 0,
        items_active_total INTEGER NOT NULL DEFAULT 0, observations TEXT
      );
      CREATE TABLE company_placement (
        placement_id TEXT PRIMARY KEY, company_key TEXT, type TEXT,
        source_id TEXT, health TEXT
      );
    `);
    db.prepare(
      `INSERT INTO company_directory VALUES ('globex', 'Globex', 'https://globex.io', 'https://globex.io/careers', '123456', NULL, NULL, 'active')`,
    ).run();
    db.prepare(
      `INSERT INTO vacancy_source_state (source_id, last_status, last_error_message, items_found_total, observations)
       VALUES ('src-company-site-globex', 'disabled', 'vacancy_source_unreachable: 404', 0, NULL)`,
    ).run();
    db.prepare(
      `INSERT INTO company_placement VALUES ('site:globex.io', 'globex', 'employer_site', 'src-company-site-globex', 'gone')`,
    ).run();

    const summary = readChannelHealthSummary(db, NOW);
    expect(summary.unhealthySourceIds?.has('src-company-site-globex')).toBe(true);
    expect(summary.goneCompanySiteKeys?.has('globex')).toBe(true);
    expect(isAtsUnavailable('ats-greenhouse-gone', { unavailableAtsSourceIds: new Set(['ats-greenhouse-gone']) })).toBe(true);

    const resolved = resolveCompanyChannel(db, REGISTRY, 'globex', NOW);
    expect(resolved.primary).toMatchObject({
      companyKey: 'globex',
      kind: 'linkedin_company',
      sourceId: 'src-company-li-globex',
    });
    expect(resolved.retiredSourceIds).toContain('src-company-site-globex');
    db.close();
  });
});
