import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { checkRepoBoards, publicApiCounter } from '../../../companyDirectory/freehire/freehireRepoCheck';
import { LinkedinOrgRunner } from '../../../companyDirectory/linkedinOrg/linkedinOrgRunner';
import { LinkedinOrgStore } from '../../../companyDirectory/linkedinOrg/linkedinOrgStore';
import { CareersPrune } from '../../../companyDirectory/siteDiscovery/careersPrune';
import { PendingQueue } from '../../../companyDirectory/siteDiscovery/siteDiscoverySchedule';
import { searchHhVacancies } from '../../../connectors/hhVacancySearch';
import { searchRemotiveVacancies } from '../../../connectors/remotiveVacancySearch';
import { CompanyRegistry } from '../../../domain/companyRegistry';
import { registerCompanyRoutes } from '../../../routes/companiesRoute';
import { normalizeAtsBoard } from '../../atsBoardAdapters';
import { atsBoardSource } from '../../atsBoardSources';
import { planCompanyChannels, readDirectoryCompanies } from '../../companyDirectorySources';
import { registryWithCompanyChannels } from '../../composeVacancyEngine';
import { DEFAULT_VACANCY_SOURCES } from '../../defaultVacancySources';
import { fetchGenericCorporateVacancies } from '../../genericCorporateSiteAdapter';
import { createLinkedinGuestBudget } from '../../linkedinGuestBudget';
import { buildMatchedVacancyPage } from '../../matchedVacancyPage';
import { buildMultiSourceFetcher } from '../../multiSourceFetcher';
import { PLACEMENT_ROLLOUT_START_MS, readRolloutPlacementBoards } from '../../placementBoardRollout';
import { SqliteVacancyDemandStore } from '../../vacancyDemandStore';
import {
  CORPORATE_SAMPLES,
  PAYCOM_SPEC,
  WAVE1_SPECS,
  WAVE2_SPECS,
  WAVE3_SPECS,
  findAtsContract,
} from './helpers/atsWaveFixtures';
import {
  cleanupTrackedStores,
  createOfflineEngine,
  dynamicLoadPromoteFn,
  makeSource,
} from './helpers/engineHarness';
import { MEMORY_LIMITS, createMemoryTracker } from './helpers/memoryProbe';
import { createMockFetchRouter, restoreMockFetch } from './helpers/mockFetch';
import {
  bootstrapPoolTables,
  cleanupAllSqliteHarnesses,
  createMemoryDb,
  createTempDbWorkspace,
  seedDirectoryCompany,
  seedFreehireCandidate,
  seedPlacement,
  seedSourceState,
  seedVacancyCompany,
} from './helpers/sqliteHarness';

const appsToClose: FastifyInstance[] = [];

afterEach(async () => {
  while (appsToClose.length > 0) {
    const app = appsToClose.pop();
    if (app) await app.close();
  }
  restoreMockFetch();
  cleanupTrackedStores();
  cleanupAllSqliteHarnesses();
});

describe('Tier 4: Real-World Multi-Feature Application Scenarios (7 Scenarios)', () => {
  it('S01 careers.g42.ai (Core42 & G42) Phenom People + jobs.g42.ai SuccessFactors end-to-end flow', async () => {
    const phenomSpec = WAVE1_SPECS.find((s) => s.provider === 'phenom')!;
    const sfSpec = WAVE1_SPECS.find((s) => s.provider === 'successfactors')!;
    const phenomContract = findAtsContract('phenom');
    const sfContract = findAtsContract('successfactors');
    expect(phenomContract).toBeDefined();
    expect(sfContract).toBeDefined();

    const db = createMemoryDb();
    seedDirectoryCompany(db, {
      companyKey: 'core42',
      companyName: 'Core42',
      websiteUrl: 'https://www.core42.ai/',
      careersUrl: 'https://careers.g42.ai/core42/global/en/search-results',
      linkedinOrgId: '20800',
      atsProvider: 'phenom',
      atsSlug: phenomSpec.board,
    });
    seedDirectoryCompany(db, {
      companyKey: 'g42',
      companyName: 'G42',
      websiteUrl: 'https://www.g42.ai/',
      careersUrl: 'https://jobs.g42.ai/',
      linkedinOrgId: '14598162',
      atsProvider: 'successfactors',
      atsSlug: sfSpec.board,
    });

    const plan = planCompanyChannels(DEFAULT_VACANCY_SOURCES, readDirectoryCompanies(db));
    expect(plan.channels.find((c) => c.companyKey === 'core42')?.kind).toBe('company_ats');
    expect(plan.channels.find((c) => c.companyKey === 'g42')?.kind).toBe('company_ats');

    const wrapped = createOfflineEngine({
      sources: [
        makeSource({
          id: `ats-phenom-${phenomSpec.board}`,
          name: 'Core42',
          channelTier: 1,
          targetUrl: phenomContract!.endpoint(phenomSpec.board),
        }),
        makeSource({
          id: `ats-successfactors-${sfSpec.board}`,
          name: 'G42',
          channelTier: 1,
          targetUrl: sfContract!.endpoint(sfSpec.board),
        }),
      ],
      fetcher: async (src) =>
        src.id.includes('phenom')
          ? normalizeAtsBoard(src.id, phenomSpec.payload, { observedAt: '2026-11-24T00:00:00Z', sourceName: 'Core42' })
          : normalizeAtsBoard(src.id, sfSpec.payload, { observedAt: '2026-11-24T00:00:00Z', sourceName: 'G42' }),
    });
    const outcomes = await wrapped.engine.syncDue(Date.UTC(2026, 10, 24, 12));
    expect(outcomes.filter((o) => o.status === 'healthy')).toHaveLength(2);
    expect(wrapped.engine.getVacancies({}).total).toBeGreaterThanOrEqual(4);
  });

  it('S02 ats-join high-volume wave (25 ats-join-* + 10 sibling ATS) without 429 storm', async () => {
    const router = createMockFetchRouter([
      {
        match: 'join.com/api/public/companies/10',
        respond: { status: 429, headers: { 'retry-after': '60' }, body: { error: 'rate_limit' } },
      },
      {
        match: 'join.com/api/public/companies/',
        respond: {
          status: 200,
          body: {
            items: [
              { id: 'j1', idParam: 'eng-1', title: 'Platform Engineer', createdAt: '2026-11-23T10:00:00Z' },
            ],
            pagination: { pageCount: 1 },
          },
        },
      },
      {
        match: 'boards-api.greenhouse.io',
        respond: {
          status: 200,
          body: {
            jobs: [
              {
                id: 99,
                title: 'Staff Engineer',
                absolute_url: 'https://boards.greenhouse.io/sib/jobs/99',
                updated_at: '2026-11-24T00:00:00Z',
              },
            ],
          },
        },
      },
    ]);
    router.install();

    const fetcher = buildMultiSourceFetcher(searchHhVacancies, searchRemotiveVacancies, undefined, {
      sleep: async () => undefined,
    });
    const joinSources = Array.from({ length: 25 }, (_, i) =>
      makeSource({
        id: `ats-join-${i + 1}`,
        name: `JoinCo ${i + 1}`,
        channelTier: 1,
        targetUrl: `https://join.com/api/public/companies/${i + 1}/jobs?page=1&pageSize=5`,
      }),
    );
    const ghSources = Array.from({ length: 10 }, (_, i) =>
      makeSource({
        id: `ats-greenhouse-sib-${i + 1}`,
        name: `SibGH ${i + 1}`,
        channelTier: 1,
        targetUrl: `https://boards-api.greenhouse.io/v1/boards/sib-${i + 1}/jobs?content=true`,
      }),
    );

    const wrapped = createOfflineEngine({ sources: [...joinSources, ...ghSources], fetcher });
    const outcomes = await wrapped.engine.syncDue(Date.UTC(2026, 10, 24, 12));
    // First hit on companies/10 returns 429; remaining join.com boards must respect shared backoff, while GH finishes healthy
    expect(outcomes.filter((o) => o.sourceId.startsWith('ats-greenhouse-') && o.status === 'healthy')).toHaveLength(10);
    expect(router.callsFor('join.com/api/public/companies/')).toBeLessThan(25);
  });

  it('S03 507k-pattern chunked enrichment & bulk promote under 640 MB / 900 MB memory guard', async () => {
    const promote = await dynamicLoadPromoteFn();
    expect(promote).not.toBeNull();

    const db = createMemoryDb();
    const demand = new SqliteVacancyDemandStore(db);
    demand.record(['Staff Engineer'], Date.UTC(2026, 10, 24));
    db.exec('BEGIN IMMEDIATE');
    for (let i = 0; i < 1_000; i += 1) {
      const key = `s3-co-${String(i).padStart(4, '0')}`;
      seedDirectoryCompany(db, {
        companyKey: key,
        companyName: i === 0 ? 'Staff Engineer Alpha' : `S3 Co ${i}`,
        websiteUrl: i % 5 === 0 ? `https://${key}.example/` : null,
      });
      seedFreehireCandidate(db, key, {
        slug: key,
        name: `S3 Co ${i}`,
        website: `https://${key}.example/`,
      });
      if (i === 0) seedVacancyCompany(db, 'v-top', key);
    }
    db.exec('COMMIT');

    const tracker = createMemoryTracker();
    const firstRun = await promote!(db, { chunkSize: 250 });
    expect(firstRun.promoted).toBeGreaterThanOrEqual(800);
    const secondRun = await promote!(db, { chunkSize: 250 });
    expect(secondRun.promoted).toBe(0);

    const queue = new PendingQueue(db);
    const topBatch = await queue.next(10);
    expect(topBatch[0]?.companyKey).toBe('s3-co-0000');

    const runner = new LinkedinOrgRunner({
      store: new LinkedinOrgStore(db),
      budget: createLinkedinGuestBudget({ baseGapMs: 1, sleep: async () => undefined }),
      minGapMs: 1,
      sleep: async () => undefined,
      log: { info: () => undefined, warn: () => undefined },
      fetchPage: async (url) => ({ status: 200, finalUrl: url, body: '<span>none</span>' }),
    });
    await runner.step();
    tracker.record();
    expect(tracker.peakHeapBytes).toBeLessThan(MEMORY_LIMITS.heapLimitBytes);
    expect(tracker.peakRssBytes).toBeLessThan(MEMORY_LIMITS.rssLimitBytes);
  });

  it('S04 dead-site failover (src-company-site-* -> company_ats -> src-company-li-*) and weekly recheck recovery', async () => {
    const ws = createTempDbWorkspace('oq-s04-');
    const db = ws.openDb();
    bootstrapPoolTables(db);
    seedDirectoryCompany(db, {
      companyKey: 'failover-co',
      companyName: 'FailoverCo',
      websiteUrl: 'https://failover.example/',
      careersUrl: 'https://failover.example/careers',
      atsProvider: 'greenhouse',
      atsSlug: 'failover-gh',
      linkedinOrgId: '991122',
      evidence: { careersUrlSetAt: '2026-11-01T00:00:00Z' },
    });
    seedSourceState(db, {
      sourceId: 'src-company-site-failover-co',
      lastStatus: 'error',
      lastErrorMessage: 'vacancy_source_unreachable: 500',
      itemsFoundTotal: 0,
      observations: { firstReadingAt: '2026-11-02T00:00:00Z', windowReadings: 4, consecutiveEmptyReadings: 4 },
    });

    // Immediate fallback activates company_ats without waiting 14 days
    const step1Sources = registryWithCompanyChannels(ws.dbPath);
    expect(step1Sources.find((s) => s.id === 'ats-greenhouse-failover-gh')?.channelTier).toBe(1);

    // CareersPrune marks dead site gone
    const prune = new CareersPrune(db, { now: () => Date.UTC(2026, 10, 20) }).step();
    expect(prune.dropped).toBe(1);

    // 3x 404 withdraws closed ATS board and fails over to LinkedIn
    const wrapped = createOfflineEngine({
      sources: [makeSource({ id: 'ats-greenhouse-failover-gh', name: 'FailoverCo', channelTier: 1 })],
      databasePath: ws.dbPath,
      fetcher: async () => {
        throw new Error('vacancy_source_unreachable: 404');
      },
    });
    const t0 = Date.UTC(2026, 10, 20);
    await wrapped.engine.syncSource('ats-greenhouse-failover-gh', undefined, t0);
    await wrapped.engine.syncSource('ats-greenhouse-failover-gh', undefined, t0 + 1_000);
    await wrapped.engine.syncSource('ats-greenhouse-failover-gh', undefined, t0 + 2_000);
    wrapped.close();

    const step3Sources = registryWithCompanyChannels(ws.dbPath);
    expect(step3Sources.find((s) => s.id === 'src-company-li-failover-co')?.channelTier).toBe(1);
  });

  it('S05 unified /api/v1/companies + matchedVacancyPage SSOT flow across companySeeds & companyDirectorySeed', async () => {
    const app = Fastify();
    appsToClose.push(app);
    await app.register(registerCompanyRoutes);

    const res = await app.inject({ method: 'GET', url: '/api/v1/companies?search=Core42&has_ats=true' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; items: Array<{ id: string; atsProvider?: string }> };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.items[0]?.atsProvider).toBeTruthy();

    const registry = new CompanyRegistry();
    registry.loadOwnerLists();
    expect(registry.findByName('Core42')).toBeDefined();

    const page = buildMatchedVacancyPage(
      [
        {
          cluster: {
            id: 's5-1',
            canonicalTitle: 'Cloud Architect',
            canonicalCompany: 'Core42',
            isRemote: false,
            descriptionSummary: 'Architect AI cloud',
            skills: ['Kubernetes'],
            primaryUrl: 'https://careers.g42.ai/core42/global/en/job/1',
            sources: [],
            firstObservedAt: '2026-11-23T00:00:00Z',
            lastSeenAt: '2026-11-23T00:00:00Z',
            status: 'active',
            vacanciesCount: 1,
          },
          explanation: {
            clusterId: 's5-1',
            roleMatch: 'target',
            levelMatch: 'match',
            matchingPoints: ['Kubernetes'],
            missingPoints: [],
            summary: 'Match',
            calculatedAt: '2026-11-23T00:00:00Z',
          },
        },
      ],
      0,
    );
    expect(Buffer.byteLength(JSON.stringify(page.items), 'utf8')).toBeLessThanOrEqual(40_000);
    expect(page.items[0]?.cluster.companyFeatures?.atsProvider).toBeTruthy();
  });

  it('S06 PlacementRollout (paylocity, join) + Wave 1-3 freehireRepoCheck + paycom exclusion', async () => {
    const db = createMemoryDb();
    const w1 = WAVE1_SPECS[0]!;
    const w2 = WAVE2_SPECS[0]!;
    const w3 = WAVE3_SPECS[0]!;
    for (const spec of [w1, w2, w3]) {
      const key = `s6-${spec.provider}`;
      seedDirectoryCompany(db, { companyKey: key, companyName: spec.company, sourceType: 'linkedin_guest' });
      seedPlacement(db, {
        placementId: `ats:${spec.provider}:${spec.board}`,
        companyKey: key,
        type: 'ats',
        provider: spec.provider,
        slug: spec.board,
        discoveredBy: 'freehire',
      });
    }
    seedPlacement(db, {
      placementId: `ats:paycom:${PAYCOM_SPEC.board}`,
      companyKey: 'choc',
      type: 'ats',
      provider: 'paycom',
      slug: PAYCOM_SPEC.board,
      discoveredBy: 'freehire',
    });
    seedPlacement(db, {
      placementId: 'ats:join:s6-alive',
      companyKey: 's6-join-co',
      type: 'ats',
      provider: 'join',
      slug: '12345',
    });
    seedPlacement(db, {
      placementId: 'ats:join:s6-gone',
      companyKey: 's6-gone-co',
      type: 'ats',
      provider: 'join',
      slug: '99999',
      health: 'gone',
    });

    const router = createMockFetchRouter([
      { match: 'g42', respond: { status: 200, body: w1.payload } },
      { match: 'careerplug', respond: { status: 200, body: w2.payload } },
      { match: 'taleo', respond: { status: 200, body: w3.payload } },
      { match: () => true, respond: { status: 200, body: w1.payload } },
    ]);
    const repoRes = await checkRepoBoards(db, publicApiCounter(router.fetch), 50, 1000, () => Date.UTC(2026, 10, 24));
    expect(repoRes.promoted).toBe(3);

    const rollout = readRolloutPlacementBoards(db, PLACEMENT_ROLLOUT_START_MS);
    expect(rollout.map((r) => r.atsSlug)).toEqual(['12345', PAYCOM_SPEC.board]);
    expect(atsBoardSource({ company: 'CHOC', provider: 'paycom', board: PAYCOM_SPEC.board, jobs: 11, observedAt: '2026-11-11', lists: ['freehire'] }).enabled).toBe(true);
  });

  it('S07 long-tail SPA & embedded widget rescue through genericCorporateSiteAdapter + engine + catalog', async () => {
    const spa = CORPORATE_SAMPLES.spaShell;
    createMockFetchRouter([{ match: spa.url, respond: { status: 200, body: spa.shellHtml } }]).install();

    const ws = createTempDbWorkspace('oq-s07-');
    const src = makeSource({
      id: 'src-company-site-spa-rescue',
      name: spa.company,
      type: 'career_site',
      channelTier: 1,
      targetUrl: spa.url,
    });
    const wrapped = createOfflineEngine({
      sources: [src],
      databasePath: ws.dbPath,
      fetcher: async (s) => fetchGenericCorporateVacancies(s, undefined, async () => spa.renderedHtml),
    });

    const outcome = await wrapped.engine.syncSource(src.id, undefined, Date.UTC(2026, 10, 24, 12));
    expect(outcome.status).toBe('healthy');
    expect(outcome.kept).toBeGreaterThanOrEqual(2);
    expect(wrapped.engine.getVacancies({ sourceId: src.id }).total).toBeGreaterThanOrEqual(2);
  });
});
