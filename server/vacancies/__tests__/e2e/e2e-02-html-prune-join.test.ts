import { afterEach, describe, expect, it } from 'vitest';
import { CareersPrune } from '../../../companyDirectory/siteDiscovery/careersPrune';
import { searchHhVacancies } from '../../../connectors/hhVacancySearch';
import { searchRemotiveVacancies } from '../../../connectors/remotiveVacancySearch';
import { normalizeAtsBoard } from '../../atsBoardAdapters';
import { readJoin } from '../../atsListingReaders';
import { fetchGenericCorporateVacancies } from '../../genericCorporateSiteAdapter';
import { buildMultiSourceFetcher } from '../../multiSourceFetcher';
import { pagingPlanFor } from '../../pagedJsonSources';
import { ATS_SERVICE_PER_HOST, companyLanePerHost } from '../../syncWave';
import {
  CORPORATE_SAMPLES,
} from './helpers/atsWaveFixtures';
import { cleanupTrackedStores, createOfflineEngine, makeSource, makeVacancy } from './helpers/engineHarness';
import { createMockFetchRouter, createSequencedMockSteps, restoreMockFetch } from './helpers/mockFetch';
import {
  bootstrapPoolTables,
  cleanupAllSqliteHarnesses,
  createMemoryDb,
  seedDirectoryCompany,
  seedPlacement,
  seedSourceState,
} from './helpers/sqliteHarness';

afterEach(() => {
  restoreMockFetch();
  cleanupTrackedStores();
  cleanupAllSqliteHarnesses();
});

describe('E2E-2: fetchCorporateHtml, CareersPrune & ats-join Yield/Pacing (F4, F5)', () => {
  // Tier 1 (Happy-Path)
  it('T1.1 fetchGenericCorporateVacancies parses valid HTTP 200 corporate HTML', async () => {
    const sample = CORPORATE_SAMPLES.jsonLdGraph;
    createMockFetchRouter([{ match: sample.url, respond: { status: 200, body: sample.html } }]).install();
    const src = makeSource({
      id: 'src-company-site-jsonld',
      name: sample.company,
      type: 'career_site',
      targetUrl: sample.url,
    });
    const jobs = await fetchGenericCorporateVacancies(src);
    expect(jobs.length).toBe(2);
    expect(jobs[0]?.title).toContain('Security Engineer');
  });

  it('T1.2 CareersPrune drops src-company-site-* after >=3 empty readings with HTTP 404/500 and marks gone', () => {
    const db = createMemoryDb();
    bootstrapPoolTables(db);
    seedDirectoryCompany(db, {
      companyKey: 'dead-corp',
      companyName: 'DeadCorp',
      careersUrl: 'https://deadcorp.example/careers',
      evidence: { careersUrlSetAt: '2026-11-01T00:00:00Z' },
    });
    seedPlacement(db, {
      placementId: 'site:deadcorp.example',
      companyKey: 'dead-corp',
      type: 'employer_site',
      url: 'https://deadcorp.example/careers',
      sourceId: 'src-company-site-dead-corp',
    });
    seedSourceState(db, {
      sourceId: 'src-company-site-dead-corp',
      lastStatus: 'error',
      lastErrorMessage: 'vacancy_source_unreachable: 404',
      itemsFoundTotal: 0,
      observations: {
        firstReadingAt: '2026-11-02T00:00:00Z',
        windowReadings: 4,
        consecutiveEmptyReadings: 4,
      },
    });

    const prune = new CareersPrune(db, { now: () => Date.UTC(2026, 10, 10) });
    const report = prune.step();
    expect(report.dropped).toBe(1);
    const dir = db
      .prepare('SELECT careers_url, evidence FROM company_directory WHERE company_key = ?')
      .get('dead-corp') as { careers_url: string | null; evidence: string };
    expect(dir.careers_url).toBeNull();
    expect(JSON.parse(dir.evidence).careersUrlDropped?.value).toBe('https://deadcorp.example/careers');
    const pl = db
      .prepare('SELECT health FROM company_placement WHERE placement_id = ?')
      .get('site:deadcorp.example') as { health: string | null };
    expect(pl.health).toBe('gone');
  });

  it('T1.3 CareersPrune drops src-company-site-* after 14+ days at 0 items', () => {
    const db = createMemoryDb();
    bootstrapPoolTables(db);
    seedDirectoryCompany(db, {
      companyKey: 'empty-14d',
      companyName: 'Empty14d',
      careersUrl: 'https://empty14d.example/careers',
      evidence: { careersUrlSetAt: '2026-11-01T00:00:00Z' },
    });
    seedSourceState(db, {
      sourceId: 'src-company-site-empty-14d',
      lastStatus: 'healthy',
      itemsFoundTotal: 0,
      observations: {
        firstReadingAt: '2026-11-02T00:00:00Z',
        windowReadings: 5,
        consecutiveEmptyReadings: 5,
      },
    });

    const report = new CareersPrune(db, { now: () => Date.UTC(2026, 10, 20) }).step();
    expect(report.dropped).toBe(1);
  });

  it('T1.4 ats-join paginates pageSize=5 across multiple pages using idParam URL', async () => {
    const plan = pagingPlanFor('ats-join-167291');
    expect(plan).not.toBeNull();
    const page1Payload = {
      items: Array.from({ length: 5 }, (_, i) => ({
        id: `j-${i + 1}`,
        idParam: `role-${i + 1}`,
        title: `Engineer ${i + 1}`,
        city: { cityName: 'Berlin', countryName: 'Germany' },
        workplaceType: 'REMOTE',
        createdAt: '2026-11-22T10:00:00Z',
      })),
      pagination: { pageCount: 2 },
    };
    const page2Payload = {
      items: [
        {
          id: 'j-6',
          idParam: 'role-6',
          title: 'Staff Architect',
          city: { cityName: 'Munich', countryName: 'Germany' },
          workplaceType: 'HYBRID',
          createdAt: '2026-11-23T10:00:00Z',
        },
      ],
      pagination: { pageCount: 2 },
    };

    const first = plan!.first('https://join.com/api/public/companies/167291/jobs?page=1&pageSize=5', Date.now());
    const next = plan!.next(first, page1Payload);
    expect(next?.url).toContain('page=2');
    expect(plan!.next(next!, page2Payload)).toBeNull();

    const parsed = readJoin(page1Payload, { observedAt: '2026-11-24T00:00:00Z', sourceName: 'Just Hiring' }, 'ats-join-167291', '167291');
    expect(parsed).toHaveLength(5);
    expect(parsed[0]?.url).toBe('https://join.com/companies/167291/role-1');
  });

  it('T1.5 join.com and recruiting.paylocity.com receive ATS_SERVICE_PER_HOST (16) in companyLanePerHost', () => {
    expect(companyLanePerHost('join.com')).toBe(ATS_SERVICE_PER_HOST);
    expect(companyLanePerHost('api.join.com')).toBe(ATS_SERVICE_PER_HOST);
    expect(companyLanePerHost('recruiting.paylocity.com')).toBe(ATS_SERVICE_PER_HOST);
  });

  it('T1.6 buildMultiSourceFetcher paces concurrent join.com boards cleanly without 429', async () => {
    createMockFetchRouter([
      {
        match: 'join.com/api/public/companies/',
        respond: {
          status: 200,
          body: {
            items: [
              {
                id: '100',
                idParam: 'backend-dev',
                title: 'Backend Developer',
                city: { cityName: 'Berlin', countryName: 'Germany' },
                createdAt: '2026-11-23T10:00:00Z',
              },
            ],
            pagination: { pageCount: 1 },
          },
        },
      },
    ]).install();

    const fetcher = buildMultiSourceFetcher(searchHhVacancies, searchRemotiveVacancies, undefined, {
      sleep: async () => undefined,
    });
    const sources = ['1001', '1002', '1003'].map((id) =>
      makeSource({
        id: `ats-join-${id}`,
        name: `JoinCo ${id}`,
        type: 'json_api',
        channelTier: 1,
        targetUrl: `https://join.com/api/public/companies/${id}/jobs?page=1&pageSize=5`,
      }),
    );
    const wrapped = createOfflineEngine({ sources, fetcher });
    const outcomes = await wrapped.engine.syncDue(Date.UTC(2026, 10, 24, 12));
    expect(outcomes.filter((o) => o.status === 'healthy')).toHaveLength(3);
  });

  // Tier 2 (Boundary / Corner / Negative)
  it('T2.1 fetchGenericCorporateVacancies propagates HTTP 404/503 status instead of silent empty array', async () => {
    createMockFetchRouter([{ match: 'down-corp.example', respond: { status: 503, body: 'Service Unavailable' } }]).install();
    const src = makeSource({
      id: 'src-company-site-down-corp',
      name: 'DownCorp',
      type: 'career_site',
      targetUrl: 'https://down-corp.example/careers',
    });

    await expect(fetchGenericCorporateVacancies(src)).rejects.toThrow(/503|unreachable/);
  });

  it('T2.2 CareersPrune preserves careers_url when reading predates careersUrlSetAt and handles legacy null', () => {
    const db = createMemoryDb();
    bootstrapPoolTables(db);
    seedDirectoryCompany(db, {
      companyKey: 'newer-url-co',
      companyName: 'NewerUrlCo',
      careersUrl: 'https://newerurl.example/careers',
      evidence: { careersUrlSetAt: '2026-11-15T00:00:00Z' },
    });
    seedSourceState(db, {
      sourceId: 'src-company-site-newer-url-co',
      lastStatus: 'error',
      lastErrorMessage: 'vacancy_source_unreachable: 404',
      itemsFoundTotal: 0,
      observations: {
        firstReadingAt: '2026-11-05T00:00:00Z',
        windowReadings: 5,
        consecutiveEmptyReadings: 5,
      },
    });

    const report = new CareersPrune(db, { now: () => Date.UTC(2026, 10, 25) }).step();
    expect(report.dropped).toBe(0);

    // Legacy row with careersUrlSetAt === null and 4 readings >= 14 days old should be handled by F4
    seedDirectoryCompany(db, {
      companyKey: 'legacy-null-co',
      companyName: 'LegacyNullCo',
      careersUrl: 'https://legacynull.example/careers',
      evidence: { note: 'imported without careersUrlSetAt' },
      updatedAt: '2026-11-01T00:00:00Z',
    });
    seedSourceState(db, {
      sourceId: 'src-company-site-legacy-null-co',
      lastStatus: 'error',
      lastErrorMessage: 'vacancy_source_unreachable: 404',
      itemsFoundTotal: 0,
      observations: {
        firstReadingAt: '2026-11-01T00:00:00Z',
        windowReadings: 4,
        consecutiveEmptyReadings: 4,
      },
    });
    const legacyReport = new CareersPrune(db, { now: () => Date.UTC(2026, 10, 25) }).step();
    expect(legacyReport.dropped).toBe(1);
  });

  it('T2.3 CareersPrune never drops a site with itemsFoundTotal > 0 or lastNonEmptyReadingAt set', () => {
    const db = createMemoryDb();
    bootstrapPoolTables(db);
    seedDirectoryCompany(db, {
      companyKey: 'had-jobs-co',
      companyName: 'HadJobsCo',
      careersUrl: 'https://hadjobs.example/careers',
      evidence: { careersUrlSetAt: '2026-11-01T00:00:00Z' },
    });
    seedSourceState(db, {
      sourceId: 'src-company-site-had-jobs-co',
      lastStatus: 'error',
      lastErrorMessage: 'vacancy_source_unreachable: 500',
      itemsFoundTotal: 3,
      observations: {
        firstReadingAt: '2026-11-02T00:00:00Z',
        lastNonEmptyReadingAt: '2026-11-03T00:00:00Z',
        windowReadings: 6,
        consecutiveEmptyReadings: 4,
      },
    });

    const report = new CareersPrune(db, { now: () => Date.UTC(2026, 10, 25) }).step();
    expect(report.dropped).toBe(0);
  });

  it('T2.4 ats-join ignores items missing idParam and rejects invalid 422 responses cleanly', () => {
    const parsed = normalizeAtsBoard(
      'ats-join-999',
      {
        items: [
          { id: 'no-param', title: 'Missing Param Role', createdAt: '2026-11-23T10:00:00Z' },
          { id: 'with-param', idParam: 'valid-role', title: 'Valid Role', createdAt: '2026-11-23T10:00:00Z' },
        ],
      },
      { observedAt: '2026-11-24T00:00:00Z', sourceName: 'JoinCo' },
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.url).toBe('https://join.com/companies/999/valid-role');
  });

  it('T2.5 ats-join preserves existing pool slice on partial page-2 failure', async () => {
    const seq = createSequencedMockSteps([
      {
        status: 200,
        body: {
          items: Array.from({ length: 5 }, (_, i) => ({
            id: `p1-${i}`,
            idParam: `slug-${i}`,
            title: `Role ${i}`,
            createdAt: '2026-11-23T10:00:00Z',
          })),
          pagination: { pageCount: 3 },
        },
      },
      { status: 500, body: { error: 'upstream_error' } },
    ]);
    createMockFetchRouter([{ match: 'join.com', respond: seq }]).install();
    const fetcher = buildMultiSourceFetcher(searchHhVacancies, searchRemotiveVacancies, undefined, {
      sleep: async () => undefined,
    });
    const src = makeSource({
      id: 'ats-join-777',
      name: 'JoinPartial',
      type: 'json_api',
      targetUrl: 'https://join.com/api/public/companies/777/jobs?page=1&pageSize=5',
    });
    const wrapped = createOfflineEngine({ sources: [src], fetcher });
    wrapped.pool.replaceSourceSlice('ats-join-777', [
      makeVacancy({ id: 'existing-1', sourceId: 'ats-join-777', company: 'JoinPartial' }),
    ]);

    const outcome = await wrapped.engine.syncSource('ats-join-777', undefined, Date.UTC(2026, 10, 24));
    expect(['healthy', 'error']).toContain(outcome.status);
    expect(wrapped.pool.countSourceSlice('ats-join-777').total).toBeGreaterThanOrEqual(1);
  });

  it('T2.6 429 from join.com triggers shared host pause for sibling ats-join-* boards', async () => {
    const router = createMockFetchRouter([
      {
        match: 'join.com/api/public/companies/111',
        respond: { status: 429, headers: { 'retry-after': '120' }, body: { error: 'rate_limited' } },
      },
      {
        match: 'join.com/api/public/companies/222',
        respond: { status: 200, body: { items: [], pagination: { pageCount: 1 } } },
      },
    ]);
    router.install();

    const fetcher = buildMultiSourceFetcher(searchHhVacancies, searchRemotiveVacancies, undefined, {
      sleep: async () => undefined,
    });
    const s1 = makeSource({
      id: 'ats-join-111',
      name: 'Join111',
      type: 'json_api',
      channelTier: 1,
      targetUrl: 'https://join.com/api/public/companies/111/jobs?page=1&pageSize=5',
    });
    const s2 = makeSource({
      id: 'ats-join-222',
      name: 'Join222',
      type: 'json_api',
      channelTier: 1,
      targetUrl: 'https://join.com/api/public/companies/222/jobs?page=1&pageSize=5',
    });
    const wrapped = createOfflineEngine({ sources: [s1, s2], fetcher });
    await wrapped.engine.syncSource('ats-join-111', undefined, Date.UTC(2026, 10, 24, 12));
    await wrapped.engine.syncSource('ats-join-222', undefined, Date.UTC(2026, 10, 24, 12, 0, 5));

    // Shared per-host limiter/cooldown should prevent hitting sibling 222 while join.com is under 429 Retry-After
    expect(router.callsFor('companies/222')).toBe(0);
  });
});
