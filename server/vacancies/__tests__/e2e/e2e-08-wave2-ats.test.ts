import { afterEach, describe, expect, it } from 'vitest';
import { checkRepoBoards, publicApiCounter } from '../../../companyDirectory/freehire/freehireRepoCheck';
import { normalizeAtsBoard, parseAtsBoardSourceId } from '../../atsBoardAdapters';
import {
  WAVE2_SPECS,
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

describe('E2E-8: Wave 2 ATS Adapters (18 platforms, F12)', () => {
  // Tier 1 (18 parameterized provider tests)
  it.each(WAVE2_SPECS)(
    'T1 [$provider] registers contract, normalizes fixture, syncs engine, and promotes via freehireRepoCheck',
    async (spec) => {
      assertProviderContractAndNormalize(spec);
      await assertProviderEngineSync(spec);
      const db = createMemoryDb();
      await assertProviderFreehireRepoCheck(db, spec);
    },
  );

  // Tier 2 (Boundary / Corner / Negative)
  it('T2.1 composite slug parsing preserves cid:ccid, host/tenant/guid, ns/portal, host/id, regional domains', () => {
    const compositeCases: Array<[string, string]> = [
      ['adp', '8a680274-0b2e-46cf-b2cc-49bd2ef0c20f:9201289910657_2'],
      ['ukg', 'accessiblespace.rec.pro.ukg.net/acc1507asei/1f3e7f92-2b60-4b8d-a893-c948a630e8a8'],
      ['dayforce', '4refuel/candidateportal'],
      ['ukgready', 'saashr.com/6199997'],
      ['zohorecruit', '2basetechnologies.zohorecruit.in'],
    ];
    for (const [provider, board] of compositeCases) {
      const parsed = parseAtsBoardSourceId(`ats-${provider}-${board}`);
      expect(parsed, `Expected parseAtsBoardSourceId for ${provider}`).toEqual({ provider, board });
    }
  });

  it('T2.2 malformed non-JSON error payloads throw UNREADABLE across Wave 2 providers', () => {
    for (const provider of ['careerplug', 'apploi', 'dayforce', 'adp', 'gupy', 'gusto']) {
      expect(() =>
        normalizeAtsBoard(`ats-${provider}-demo`, '<html>500 Error</html>', {
          observedAt: '2026-11-24T00:00:00Z',
          sourceName: 'Demo',
        }),
      ).toThrow();
      expect(findAtsContract(provider), `Expected ${provider} contract`).toBeDefined();
    }
  });

  it('T2.3 empty live Wave 2 boards return [] cleanly without throwing', () => {
    const gupy = WAVE2_SPECS.find((s) => s.provider === 'gupy')!;
    assertProviderContractAndNormalize(gupy);
    const jobs = normalizeAtsBoard(
      `ats-gupy-${gupy.board}`,
      { data: [] },
      { observedAt: '2026-11-24T00:00:00Z', sourceName: gupy.company },
    );
    expect(jobs).toEqual([]);
  });

  it('T2.4 XSS javascript: URLs in Wave 2 job payloads are filtered out by isUsableVacancy', () => {
    const gusto = WAVE2_SPECS.find((s) => s.provider === 'gusto')!;
    assertProviderContractAndNormalize(gusto);
    const jobs = normalizeAtsBoard(
      `ats-gusto-${gusto.board}`,
      {
        jobs: [
          {
            id: 'xss-1',
            title: 'XSS Trap Role',
            url: 'javascript:alert(1)',
            publishedAt: '2026-11-24T00:00:00Z',
          },
        ],
      },
      { observedAt: '2026-11-24T00:00:00Z', sourceName: gusto.company },
    );
    expect(jobs).toEqual([]);
  });

  it('T2.5 robots.txt Disallow does not block Wave 2 hosts while Crawl-delay is respected', async () => {
    const careerplug = WAVE2_SPECS.find((s) => s.provider === 'careerplug')!;
    const contract = findAtsContract(careerplug.provider);
    expect(contract).toBeDefined();
    const endpoint = contract!.endpoint(careerplug.board);
    const wrapped = createOfflineEngine({
      sources: [
        makeSource({
          id: `ats-careerplug-${careerplug.board}`,
          name: careerplug.company,
          targetUrl: endpoint,
        }),
      ],
      fetchRobots: createMockRobotsFetcher({
        [new URL(endpoint).origin]: { status: 200, body: 'User-agent: *\nDisallow: /\nCrawl-delay: 3\n' },
      }),
      fetcher: async () => [],
    });
    const outcome = await wrapped.engine.syncSource(`ats-careerplug-${careerplug.board}`, undefined, Date.now());
    expect(outcome.status).toBe('healthy');
    expect(wrapped.engine.getScheduler().getScheduleInfo(`ats-careerplug-${careerplug.board}`).crawlDelaySeconds).toBe(3);
  });

  it('T2.6 freehireRepoCheck respects dailyCap and never overwrites existing ats_provider', async () => {
    const db = createMemoryDb();
    seedDirectoryCompany(db, {
      companyKey: 'keep-existing-ats',
      companyName: 'KeepExisting',
      atsProvider: 'greenhouse',
      atsSlug: 'existing-gh',
      sourceType: 'ats_direct',
    });
    seedPlacement(db, {
      placementId: 'ats:gupy:85606',
      companyKey: 'keep-existing-ats',
      type: 'ats',
      provider: 'gupy',
      slug: '85606',
      discoveredBy: 'freehire',
    });

    const gupy = WAVE2_SPECS.find((s) => s.provider === 'gupy')!;
    const router = createMockFetchRouter([{ match: () => true, respond: { status: 200, body: gupy.payload } }]);
    const totals = await checkRepoBoards(db, publicApiCounter(router.fetch), 10, 0, () => Date.UTC(2026, 10, 24));
    expect(totals.checked).toBe(0);
    const row = db
      .prepare('SELECT ats_provider FROM company_directory WHERE company_key = ?')
      .get('keep-existing-ats') as { ats_provider: string };
    expect(row.ats_provider).toBe('greenhouse');
  });
});
