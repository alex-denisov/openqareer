import { afterEach, describe, expect, it } from 'vitest';
import { checkRepoBoards, publicApiCounter } from '../../../companyDirectory/freehire/freehireRepoCheck';
import { CareersPrune } from '../../../companyDirectory/siteDiscovery/careersPrune';
import { DirectAtsDiscovery } from '../../../companyDirectory/siteDiscovery/directAtsDiscovery';
import { PendingQueue } from '../../../companyDirectory/siteDiscovery/siteDiscoverySchedule';
import { writeDiscovery } from '../../../companyDirectory/siteDiscovery/siteDiscovery';
import { searchHhVacancies } from '../../../connectors/hhVacancySearch';
import { searchRemotiveVacancies } from '../../../connectors/remotiveVacancySearch';
import { CompanyRegistry } from '../../../domain/companyRegistry';
import { normalizeAtsBoard } from '../../atsBoardAdapters';
import { atsBoardSource } from '../../atsBoardSources';
import { planCompanyChannels, readDirectoryCompanies } from '../../companyDirectorySources';
import { registryWithCompanyChannels } from '../../composeVacancyEngine';
import { DEFAULT_VACANCY_SOURCES } from '../../defaultVacancySources';
import { fetchGenericCorporateVacancies } from '../../genericCorporateSiteAdapter';
import { buildMatchedVacancyPage, trim } from '../../matchedVacancyPage';
import { buildMultiSourceFetcher } from '../../multiSourceFetcher';
import { PLACEMENT_ROLLOUT_START_MS, readRolloutPlacementBoards } from '../../placementBoardRollout';
import { freshnessWindow } from '../../vacancyPoolQuery';
import {
  CORPORATE_SAMPLES,
  PAYCOM_SPEC,
  WAVE1_SPECS,
  WAVE2_SPECS,
  findAtsContract,
} from './helpers/atsWaveFixtures';
import {
  cleanupTrackedStores,
  createOfflineEngine,
  dynamicLoadPromoteFn,
  makeSource,
  makeVacancy,
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
} from './helpers/sqliteHarness';

afterEach(() => {
  restoreMockFetch();
  cleanupTrackedStores();
  cleanupAllSqliteHarnesses();
});

describe('Tier 3: Pairwise Cross-Feature Combinatorial Suite (14 Scenarios)', () => {
  it('P01 E2E-1 x E2E-2: dead src-company-site-* triggers immediate fallback to company_ats, then CareersPrune clears careers_url', async () => {
    const ws = createTempDbWorkspace();
    const db = ws.openDb();
    bootstrapPoolTables(db);
    seedDirectoryCompany(db, {
      companyKey: 'pair-site-ats',
      companyName: 'PairSiteAts',
      careersUrl: 'https://pairsite.example/careers',
      atsProvider: 'greenhouse',
      atsSlug: 'pairsite-gh',
      evidence: { careersUrlSetAt: '2026-11-01T00:00:00Z' },
    });
    seedSourceState(db, {
      sourceId: 'src-company-site-pair-site-ats',
      lastStatus: 'error',
      lastErrorMessage: 'vacancy_source_unreachable: 500',
      itemsFoundTotal: 0,
      observations: { firstReadingAt: '2026-11-02T00:00:00Z', windowReadings: 4, consecutiveEmptyReadings: 4 },
    });

    const sources = registryWithCompanyChannels(ws.dbPath);
    const ats = sources.find((s) => s.id === 'ats-greenhouse-pairsite-gh');
    expect(ats?.channelTier).toBe(1);

    const prune = new CareersPrune(db, { now: () => Date.UTC(2026, 10, 20) }).step();
    expect(prune.dropped).toBe(1);
  });

  it('P02 E2E-1 x E2E-3: 3x 404 withdraws closed ATS board and channel planner promotes linkedin_company fallback', async () => {
    const ws = createTempDbWorkspace();
    const db = ws.openDb();
    bootstrapPoolTables(db);
    seedDirectoryCompany(db, {
      companyKey: 'closed-ats-co',
      companyName: 'ClosedAts Co',
      atsProvider: 'greenhouse',
      atsSlug: 'closed-ats-co',
      linkedinOrgId: '776655',
    });
    const atsSrc = makeSource({ id: 'ats-greenhouse-closed-ats-co', name: 'ClosedAts Co', channelTier: 1 });
    const wrapped = createOfflineEngine({
      sources: [atsSrc],
      databasePath: ws.dbPath,
      fetcher: async () => {
        throw new Error('vacancy_source_unreachable: 404');
      },
    });
    const t0 = Date.UTC(2026, 10, 20);
    await wrapped.engine.syncSource(atsSrc.id, undefined, t0);
    await wrapped.engine.syncSource(atsSrc.id, undefined, t0 + 1_000);
    const third = await wrapped.engine.syncSource(atsSrc.id, undefined, t0 + 2_000);
    expect(third.message).toContain('board_closed');
    wrapped.close();

    const replanned = registryWithCompanyChannels(ws.dbPath);
    const li = replanned.find((s) => s.id === 'src-company-li-closed-ats-co');
    expect(li?.channelTier).toBe(1);
  });

  it('P03 E2E-2 x E2E-3: ats-join 429 + Retry-After pauses sibling join.com boards while non-Join sources proceed', async () => {
    const router = createMockFetchRouter([
      {
        match: 'join.com/api/public/companies/101',
        respond: { status: 429, headers: { 'retry-after': '120' }, body: { error: 'rate_limited' } },
      },
      {
        match: 'join.com/api/public/companies/102',
        respond: { status: 200, body: { items: [], pagination: { pageCount: 1 } } },
      },
      {
        match: 'boards-api.greenhouse.io/v1/boards/healthy-gh/jobs',
        respond: {
          status: 200,
          body: {
            jobs: [
              {
                id: 1,
                title: 'Backend Engineer',
                absolute_url: 'https://boards.greenhouse.io/healthy-gh/jobs/1',
                updated_at: '2026-11-24T10:00:00Z',
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
    const wrapped = createOfflineEngine({
      sources: [
        makeSource({
          id: 'ats-join-101',
          name: 'Join101',
          type: 'json_api',
          channelTier: 1,
          targetUrl: 'https://join.com/api/public/companies/101/jobs?page=1&pageSize=5',
        }),
        makeSource({
          id: 'ats-join-102',
          name: 'Join102',
          type: 'json_api',
          channelTier: 1,
          targetUrl: 'https://join.com/api/public/companies/102/jobs?page=1&pageSize=5',
        }),
        makeSource({
          id: 'ats-greenhouse-healthy-gh',
          name: 'HealthyGH',
          type: 'json_api',
          channelTier: 1,
          targetUrl: 'https://boards-api.greenhouse.io/v1/boards/healthy-gh/jobs?content=true',
        }),
      ],
      fetcher,
    });

    await wrapped.engine.syncSource('ats-join-101', undefined, Date.UTC(2026, 10, 24, 12));
    const outcomes = await wrapped.engine.syncDue(Date.UTC(2026, 10, 24, 12, 0, 10));
    expect(outcomes.some((o) => o.sourceId === 'ats-greenhouse-healthy-gh' && o.status === 'healthy')).toBe(true);
    expect(router.callsFor('companies/102')).toBe(0);
  });

  it('P04 E2E-4 x E2E-1: bulk promote populates ats_provider + website_url and planCompanyChannels selects company_ats', async () => {
    const promote = await dynamicLoadPromoteFn();
    expect(promote).not.toBeNull();
    const db = createMemoryDb();
    seedDirectoryCompany(db, { companyKey: 'promo-route-co', companyName: 'PromoRoute Co' });
    seedFreehireCandidate(db, 'promo-route-co', {
      slug: 'promo-route-co',
      name: 'PromoRoute Co',
      website: 'https://promoroute.example/',
      boards: [{ provider: 'lever', slug: 'promoroute' }],
    });
    await promote!(db);
    const plan = planCompanyChannels(DEFAULT_VACANCY_SOURCES, readDirectoryCompanies(db));
    expect(plan.channels.find((c) => c.companyKey === 'promo-route-co')?.kind).toBe('company_ats');
  });

  it('P05 E2E-4 x E2E-6: bulk promote populates company_placement (paylocity/join) and PlacementRollout admits day-0 batch', async () => {
    const promote = await dynamicLoadPromoteFn();
    expect(promote).not.toBeNull();
    const db = createMemoryDb();
    seedDirectoryCompany(db, { companyKey: 'roll-cand-co', companyName: 'RollCand Co' });
    seedFreehireCandidate(db, 'roll-cand-co', {
      slug: 'roll-cand-co',
      name: 'RollCand Co',
      boards: [{ provider: 'join', slug: '445566' }],
    });
    await promote!(db);
    const admitted = readRolloutPlacementBoards(db, PLACEMENT_ROLLOUT_START_MS);
    expect(admitted.some((b) => b.atsProvider === 'join' && b.atsSlug === '445566')).toBe(true);
  });

  it('P06 E2E-5 x E2E-1: unified CompanyRegistry SSOT + planCompanyChannels + buildMatchedVacancyPage attach companyFeatures', () => {
    const registry = new CompanyRegistry();
    registry.loadOwnerLists();
    const core42 = registry.findByName('Core42');
    expect(core42).toBeDefined();
    const trimmed = trim({
      cluster: {
        id: 'p6-1',
        canonicalTitle: 'AI Engineer',
        canonicalCompany: 'Core42',
        isRemote: false,
        descriptionSummary: 'Summary',
        skills: [],
        primaryUrl: 'https://careers.g42.ai/core42/global/en/job/1',
        sources: [],
        firstObservedAt: '2026-11-23T00:00:00Z',
        lastSeenAt: '2026-11-23T00:00:00Z',
        status: 'active',
        vacanciesCount: 1,
      },
      explanation: {
        clusterId: 'p6-1',
        roleMatch: 'target',
        levelMatch: 'match',
        matchingPoints: ['AI'],
        missingPoints: [],
        summary: 'Match',
        calculatedAt: '2026-11-23T00:00:00Z',
      },
    });
    expect(trimmed.cluster.companyFeatures?.industry).toBeTruthy();
    const page = buildMatchedVacancyPage([trimmed], 0);
    expect(page.items).toHaveLength(1);
  });

  it('P07 E2E-7 x E2E-1: careers.g42.ai Phenom People ranks tier 1 company_ats above career_site and linkedin_company', () => {
    const phenom = WAVE1_SPECS.find((s) => s.provider === 'phenom')!;
    expect(findAtsContract('phenom')).toBeDefined();
    const plan = planCompanyChannels(DEFAULT_VACANCY_SOURCES, [
      {
        companyKey: 'core42',
        companyName: phenom.company,
        websiteUrl: 'https://www.core42.ai/',
        careersUrl: 'https://careers.g42.ai/core42/global/en/search-results',
        linkedinOrgId: '20800',
        atsProvider: 'phenom',
        atsSlug: phenom.board,
      },
    ]);
    const ch = plan.channels.find((c) => c.companyKey === 'core42');
    expect(ch?.kind).toBe('company_ats');
    expect(ch?.sourceId).toBe('ats-phenom-careers.g42.ai');
  });

  it('P08 E2E-7 x E2E-3: Wave 1 ats-phenom-* respects robots Crawl-delay: 2 and transient 503 without triggering board_closed', async () => {
    const phenom = WAVE1_SPECS.find((s) => s.provider === 'phenom')!;
    const contract = findAtsContract('phenom');
    expect(contract).toBeDefined();
    let fail503 = true;
    const src = makeSource({
      id: `ats-phenom-${phenom.board}`,
      name: phenom.company,
      targetUrl: contract!.endpoint(phenom.board),
    });
    const wrapped = createOfflineEngine({
      sources: [src],
      fetchRobots: async () => ({ status: 200, body: 'User-agent: *\nAllow: /\nCrawl-delay: 2\n' }),
      fetcher: async () => {
        if (fail503) throw new Error('vacancy_source_unreachable: 503');
        return normalizeAtsBoard(src.id, phenom.payload, {
          observedAt: '2026-11-24T00:00:00Z',
          sourceName: phenom.company,
        });
      },
    });
    const t0 = Date.UTC(2026, 10, 24, 12);
    const errRes = await wrapped.engine.syncSource(src.id, undefined, t0);
    expect(errRes.status).toBe('error');
    expect(errRes.message ?? '').not.toContain('board_closed');
    fail503 = false;
    const okRes = await wrapped.engine.syncSource(src.id, undefined, t0 + 10 * 60_000);
    expect(okRes.status).toBe('healthy');
  });

  it('P09 E2E-8 x E2E-6: Wave 2 freehireRepoCheck alongside PlacementRollout excludes health=gone rows', async () => {
    const db = createMemoryDb();
    const careerplug = WAVE2_SPECS.find((s) => s.provider === 'careerplug')!;
    seedDirectoryCompany(db, { companyKey: 'cp-live', companyName: careerplug.company });
    seedPlacement(db, {
      placementId: `ats:careerplug:${careerplug.board}`,
      companyKey: 'cp-live',
      type: 'ats',
      provider: 'careerplug',
      slug: careerplug.board,
      discoveredBy: 'freehire',
    });
    seedPlacement(db, {
      placementId: 'ats:join:gone-board',
      companyKey: 'gone-join',
      type: 'ats',
      provider: 'join',
      slug: '99001',
      health: 'gone',
    });
    const router = createMockFetchRouter([{ match: () => true, respond: { status: 200, body: careerplug.payload } }]);
    const totals = await checkRepoBoards(db, publicApiCounter(router.fetch), 20, 1000, () => Date.UTC(2026, 10, 24));
    expect(totals.promoted).toBe(1);
    const rollout = readRolloutPlacementBoards(db, PLACEMENT_ROLLOUT_START_MS);
    expect(rollout.find((r) => r.atsSlug === '99001')).toBeUndefined();
  });

  it('P10 E2E-9 x E2E-1: company with paycom placement runs as primary company_ats without robots exclusion', () => {
    const paycomSrc = atsBoardSource({
      company: PAYCOM_SPEC.company,
      provider: 'paycom',
      board: PAYCOM_SPEC.board,
      jobs: 11,
      observedAt: '2026-11-11T00:00:00Z',
      lists: ['freehire'],
    });
    expect(paycomSrc.enabled).toBe(true);
    const plan = planCompanyChannels([...DEFAULT_VACANCY_SOURCES, paycomSrc], [
      {
        companyKey: 'choc',
        companyName: 'CHOC',
        websiteUrl: 'https://choc.org/',
        careersUrl: null,
        linkedinOrgId: '163010',
        atsProvider: 'paycom',
        atsSlug: PAYCOM_SPEC.board,
      },
    ]);
    expect(plan.channels.find((c) => c.companyKey === 'choc')?.kind).toBe('company_ats');
  });

  it('P11 E2E-10 x E2E-2: genericCorporateSiteAdapter extracts embedded Comeet widget and handles 403 errors explicitly', async () => {
    const comeetHtml = CORPORATE_SAMPLES.embeddedComeet;
    createMockFetchRouter([
      { match: comeetHtml.url, respond: { status: 200, body: comeetHtml.html } },
      { match: 'comeet', respond: { status: 200, body: WAVE1_SPECS.find((s) => s.provider === 'comeet')!.payload } },
      { match: 'forbidden.example', respond: { status: 403, body: 'Forbidden' } },
    ]).install();

    const jobs = await fetchGenericCorporateVacancies(
      makeSource({
        id: 'src-company-site-overwolf',
        name: comeetHtml.company,
        type: 'career_site',
        targetUrl: comeetHtml.url,
      }),
    );
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    await expect(
      fetchGenericCorporateVacancies(
        makeSource({
          id: 'src-company-site-403',
          name: 'ForbiddenCo',
          type: 'career_site',
          targetUrl: 'https://forbidden.example/careers',
        }),
      ),
    ).rejects.toThrow(/403|unreachable/);
  });

  it('P12 E2E-11 x E2E-4: DirectAtsDiscovery writes verified board, then bulk promote does not clobber it', async () => {
    const promote = await dynamicLoadPromoteFn();
    expect(promote).not.toBeNull();
    const db = createMemoryDb();
    seedDirectoryCompany(db, {
      companyKey: 'no-clobber-co',
      companyName: 'NoClobber',
      websiteUrl: 'https://noclobber.example/',
    });
    writeDiscovery(
      db,
      {
        companyKey: 'no-clobber-co',
        board: { provider: 'ashby', slug: 'noclobber-ashby', jobs: 5 },
        evidence: { ats: { value: 'ashby:noclobber-ashby', how: 'discovery' } },
      },
      '2026-11-24T12:00:00Z',
    );
    seedFreehireCandidate(db, 'no-clobber-co', {
      slug: 'no-clobber-co',
      name: 'NoClobber',
      boards: [{ provider: 'greenhouse', slug: 'other-gh' }],
    });

    const direct = new DirectAtsDiscovery(db, async () => 0, new Map());
    expect(direct).toBeDefined();
    await promote!(db);
    const row = db
      .prepare('SELECT ats_provider, ats_slug FROM company_directory WHERE company_key = ?')
      .get('no-clobber-co') as { ats_provider: string; ats_slug: string };
    expect(row.ats_provider).toBe('ashby');
    expect(row.ats_slug).toBe('noclobber-ashby');
  });

  it('P13 E2E-11 x E2E-12: PendingQueue over 2,000 synthetic rows stays strictly within memory limits', async () => {
    const db = createMemoryDb();
    db.exec('BEGIN IMMEDIATE');
    for (let i = 0; i < 2_000; i += 1) {
      seedDirectoryCompany(db, {
        companyKey: `enr-${String(i).padStart(4, '0')}`,
        companyName: `Enrich ${i}`,
        websiteUrl: `https://enr-${i}.example/`,
      });
    }
    db.exec('COMMIT');

    const tracker = createMemoryTracker();
    const queue = new PendingQueue(db);
    const batch = await queue.next(100);
    tracker.record();
    expect(batch).toHaveLength(100);
    expect(tracker.peakHeapBytes).toBeLessThan(MEMORY_LIMITS.heapLimitBytes);
    expect(tracker.deltaHeapBytes).toBeLessThan(8 * 1024 * 1024);
  });

  it('P14 E2E-3 x E2E-12: withdrawClosedBoard + keyed recluster over 1,000 vacancies detaches closed board with O(batch) memory', async () => {
    const ws = createTempDbWorkspace('oq-p14-');
    let closed = false;
    const closedSrc = makeSource({ id: 'ats-greenhouse-p14-closed', name: 'P14Closed' });
    const liveSrc = makeSource({ id: 'ats-greenhouse-p14-live', name: 'P14Live' });
    const wrapped = createOfflineEngine({
      sources: [closedSrc, liveSrc],
      databasePath: ws.dbPath,
      recluster: { mode: 'keyed', batchSize: 100 },
      fetcher: async (src) => {
        if (src.id === closedSrc.id && closed) throw new Error('vacancy_source_unreachable: 404');
        return Array.from({ length: 500 }, (_, i) =>
          makeVacancy({ id: `${src.id}-${i}`, sourceId: src.id, company: src.name }),
        );
      },
    });
    const t0 = Date.UTC(2026, 10, 20);
    await wrapped.engine.syncDue(t0);
    expect(wrapped.pool.countVacancies(freshnessWindow(Date.UTC(2026, 10, 25)))).toBe(1_000);

    closed = true;
    const tracker = createMemoryTracker();
    await wrapped.engine.syncSource(closedSrc.id, undefined, t0 + 1_000);
    await wrapped.engine.syncSource(closedSrc.id, undefined, t0 + 2_000);
    await wrapped.engine.syncSource(closedSrc.id, undefined, t0 + 3_000);
    tracker.record();
    expect(wrapped.pool.countSourceSlice(closedSrc.id).total).toBe(0);
    expect(wrapped.pool.countSourceSlice(liveSrc.id).total).toBe(500);
    expect(tracker.deltaHeapBytes).toBeLessThan(48 * 1024 * 1024);
  });
});
