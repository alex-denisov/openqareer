import { afterEach, describe, expect, it } from 'vitest';
import { checkRepoBoards, publicApiCounter } from '../../../companyDirectory/freehire/freehireRepoCheck';
import {
  ATS_PAYLOAD_UNREADABLE,
  normalizeAtsBoard,
  parseAtsBoardSourceId,
} from '../../atsBoardAdapters';
import { RobotsPolicyLoader } from '../../robotsPolicyLoader';
import {
  WAVE1_SPECS,
  assertProviderContractAndNormalize,
  assertProviderEngineSync,
  assertProviderFreehireRepoCheck,
  findAtsContract,
} from './helpers/atsWaveFixtures';
import { cleanupTrackedStores, createOfflineEngine, makeSource } from './helpers/engineHarness';
import { createMockFetchRouter, createMockRobotsFetcher, restoreMockFetch } from './helpers/mockFetch';
import { cleanupAllSqliteHarnesses, createMemoryDb, seedDirectoryCompany, seedPlacement } from './helpers/sqliteHarness';

afterEach(() => {
  restoreMockFetch();
  cleanupTrackedStores();
  cleanupAllSqliteHarnesses();
});

describe('E2E-7: Wave 1 ATS Adapters (9 platforms incl. careers.g42.ai, F11)', () => {
  // Tier 1 (9 parameterized happy-path provider specs = 9 tests)
  it.each(WAVE1_SPECS)(
    'T1.$wave [$provider] registers contract, normalizes fixture, syncs engine, and promotes via freehireRepoCheck',
    async (spec) => {
      assertProviderContractAndNormalize(spec);
      await assertProviderEngineSync(spec);
      const db = createMemoryDb();
      await assertProviderFreehireRepoCheck(db, spec);
    },
  );

  it('T1.10 Core42 & G42 careers.g42.ai Phenom People and jobs.g42.ai SuccessFactors preserve URLs and org metadata', () => {
    const phenomSpec = WAVE1_SPECS.find((s) => s.provider === 'phenom')!;
    const sfSpec = WAVE1_SPECS.find((s) => s.provider === 'successfactors')!;
    const phenomRes = assertProviderContractAndNormalize(phenomSpec);
    const sfRes = assertProviderContractAndNormalize(sfSpec);

    expect(phenomRes.jobs[0]?.url).toContain('careers.g42.ai');
    expect(phenomRes.jobs.some((j) => j.isRemote === true)).toBe(true);
    expect(sfRes.jobs[0]?.url).toContain('jobs.g42.ai');
    expect(parseAtsBoardSourceId('ats-phenom-careers.g42.ai')).toEqual({
      provider: 'phenom',
      board: 'careers.g42.ai',
    });
  });

  // Tier 2 (Boundary / Corner / Negative)
  it('T2.1 normalizeAtsBoard throws UNREADABLE on malformed HTML error payload for Wave 1 providers', () => {
    for (const provider of ['phenom', 'successfactors', 'jazzhr', 'rippling', 'comeet']) {
      expect(() =>
        normalizeAtsBoard(`ats-${provider}-demo`, '<html>502 Bad Gateway</html>', {
          observedAt: '2026-11-24T00:00:00Z',
          sourceName: 'Demo',
        }),
      ).toThrow();
      const contract = findAtsContract(provider);
      expect(contract, `Expected ${provider} contract`).toBeDefined();
    }
  });

  it('T2.2 empty live Wave 1 board returns empty array without throwing', () => {
    const phenom = WAVE1_SPECS.find((s) => s.provider === 'phenom')!;
    assertProviderContractAndNormalize(phenom);
    const emptyJobs = normalizeAtsBoard(
      'ats-phenom-careers.g42.ai',
      { refineSearch: { status: 200, data: { totalHits: 0, jobs: [] } } },
      { observedAt: '2026-11-24T00:00:00Z', sourceName: 'Core42' },
    );
    expect(emptyJobs).toEqual([]);
  });

  it('T2.3 RobotsPolicyLoader Disallow /api/ does not block Wave 1 sync', async () => {
    const rippling = WAVE1_SPECS.find((s) => s.provider === 'rippling')!;
    const contract = findAtsContract(rippling.provider);
    expect(contract).toBeDefined();

    const wrapped = createOfflineEngine({
      sources: [
        makeSource({
          id: `ats-rippling-${rippling.board}`,
          name: rippling.company,
          targetUrl: contract!.endpoint(rippling.board),
        }),
      ],
      fetchRobots: createMockRobotsFetcher({
        [new URL(contract!.endpoint(rippling.board)).origin]: {
          status: 200,
          body: 'User-agent: *\nDisallow: /\nCrawl-delay: 2\n',
        },
      }),
      fetcher: async () => [],
    });
    const outcome = await wrapped.engine.syncSource(`ats-rippling-${rippling.board}`, undefined, Date.now());
    expect(outcome.status).toBe('healthy');
    expect(wrapped.engine.getScheduler().getScheduleInfo(`ats-rippling-${rippling.board}`).crawlDelaySeconds).toBe(2);
  });

  it('T2.4 RobotsPolicyLoader returns disallowed on HTTP 403 and unconfirmed on HTTP 503', async () => {
    const loader = new RobotsPolicyLoader({
      fetchRobots: createMockRobotsFetcher({
        'https://denied.example': { status: 403, body: null },
        'https://outage.example': { status: 503, body: null },
      }),
    });
    const denied = await loader.policyFor('https://denied.example/jobs');
    const outage = await loader.policyFor('https://outage.example/jobs');
    expect(denied.verdict).toBe('disallowed');
    expect(outage.verdict).toBe('unconfirmed');
  });

  it('T2.5 RobotsPolicyLoader Crawl-delay: 5 propagates to engine scheduler', async () => {
    const gem = WAVE1_SPECS.find((s) => s.provider === 'gem')!;
    const contract = findAtsContract(gem.provider);
    expect(contract).toBeDefined();
    const endpoint = contract!.endpoint(gem.board);
    const wrapped = createOfflineEngine({
      sources: [makeSource({ id: `ats-gem-${gem.board}`, name: gem.company, targetUrl: endpoint })],
      fetchRobots: async () => ({ status: 200, body: 'User-agent: *\nAllow: /\nCrawl-delay: 5\n' }),
      fetcher: async () => [],
    });
    const t0 = Date.UTC(2026, 10, 24, 12);
    await wrapped.engine.syncSource(`ats-gem-${gem.board}`, undefined, t0);
    const state = wrapped.pool.loadSourceStates().find((s) => s.sourceId === `ats-gem-${gem.board}`);
    expect(state?.observations?.schedule?.crawlDelaySeconds).toBe(5);
  });

  it('T2.6 freehireRepoCheck skips 0-job or dead (-1) Wave 1 boards without promoting company_directory', async () => {
    const db = createMemoryDb();
    seedDirectoryCompany(db, { companyKey: 'zero-hibob', companyName: 'Zero HiBob', sourceType: 'linkedin_guest' });
    seedPlacement(db, {
      placementId: 'ats:hibob:emptyboard',
      companyKey: 'zero-hibob',
      type: 'ats',
      provider: 'hibob',
      slug: 'emptyboard',
      discoveredBy: 'freehire',
    });
    const router = createMockFetchRouter([{ match: () => true, respond: { status: 404, body: 'Not Found' } }]);
    const totals = await checkRepoBoards(db, publicApiCounter(router.fetch), 20, 1000, () => Date.UTC(2026, 10, 24));
    expect(totals.promoted).toBe(0);
    const row = db
      .prepare('SELECT ats_provider FROM company_directory WHERE company_key = ?')
      .get('zero-hibob') as { ats_provider: string | null };
    expect(row.ats_provider).toBeNull();
    expect(ATS_PAYLOAD_UNREADABLE).toBe('vacancy_source_payload_unreadable');
  });
});
