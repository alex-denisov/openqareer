import { afterEach, describe, expect, it } from 'vitest';
import { checkRepoBoards, publicApiCounter } from '../../../companyDirectory/freehire/freehireRepoCheck';
import {
  atsBoardSourceId,
  normalizeAtsBoard,
  parseAtsBoardSourceId,
} from '../../atsBoardAdapters';
import { atsBoardSource } from '../../atsBoardSources';
import { RobotsPolicyLoader } from '../../robotsPolicyLoader';
import {
  PAYCOM_SPEC,
  WAVE3_SPECS,
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

describe('E2E-9: Wave 3 ATS Adapters & paycom Exclusion (F13)', () => {
  // Tier 1 (14 Wave 3 providers + explicit paycom exclusion)
  it.each(WAVE3_SPECS)(
    'T1 [$provider] registers contract, normalizes fixture, syncs engine, and promotes via freehireRepoCheck',
    async (spec) => {
      assertProviderContractAndNormalize(spec);
      await assertProviderEngineSync(spec);
      const db = createMemoryDb();
      await assertProviderFreehireRepoCheck(db, spec);
    },
  );

  it('T1.15 paycom retains crawlPermission=allowed and atsBoardSource enables it', () => {
    const contract = findAtsContract('paycom');
    expect(contract).toBeDefined();
    expect(contract?.crawlPermission).toBe('allowed');

    const src = atsBoardSource({
      company: PAYCOM_SPEC.company,
      provider: 'paycom',
      board: PAYCOM_SPEC.board,
      jobs: 11,
      observedAt: '2026-11-11T00:00:00Z',
      lists: ['freehire'],
    });
    expect(src.enabled).toBe(true);
    expect(src.addressStatus).toBe('live');
  });

  // Tier 2 (Boundary / Corner / Negative)
  it('T2.1 MultiSourceVacancyEngine.syncSource syncs ats-paycom-* without robots blocking', async () => {
    let fetched = 0;
    const src = atsBoardSource({
      company: 'CHOC',
      provider: 'paycom',
      board: PAYCOM_SPEC.board,
      jobs: 11,
      observedAt: '2026-11-11T00:00:00Z',
      lists: ['freehire'],
    });
    const wrapped = createOfflineEngine({
      sources: [src],
      fetcher: async () => {
        fetched += 1;
        return [];
      },
    });
    const outcome = await wrapped.engine.syncSource(
      atsBoardSourceId('paycom', PAYCOM_SPEC.board),
      undefined,
      Date.now(),
    );
    expect(outcome.status).toBe('healthy');
    expect(fetched).toBe(1);
  });

  it('T2.2 RobotsPolicyLoader blocks paycom search endpoint via Disallow: /', async () => {
    const loader = new RobotsPolicyLoader({
      fetchRobots: createMockRobotsFetcher({
        'https://www.paycomonline.net': {
          status: 200,
          body: 'User-agent: *\nAllow: /v4/ats/web.php/portal/\nDisallow: /api/ats/job-posting-previews/search\nDisallow: /\n',
        },
      }),
    });
    const verdict = await loader.policyFor(
      'https://www.paycomonline.net/api/ats/job-posting-previews/search',
    );
    expect(verdict.verdict).toBe('disallowed');
  });

  it('T2.3 freehireRepoCheck never checks or promotes paycom placements', async () => {
    const db = createMemoryDb();
    seedDirectoryCompany(db, { companyKey: 'choc', companyName: 'CHOC', sourceType: 'linkedin_guest' });
    seedPlacement(db, {
      placementId: `ats:paycom:${PAYCOM_SPEC.board}`,
      companyKey: 'choc',
      type: 'ats',
      provider: 'paycom',
      slug: PAYCOM_SPEC.board,
      discoveredBy: 'freehire',
    });

    const router = createMockFetchRouter([{ match: () => true, respond: { status: 200, body: PAYCOM_SPEC.payload } }]);
    const totals = await checkRepoBoards(db, publicApiCounter(router.fetch), 50, 1000, () => Date.now());
    expect(totals.checked).toBe(0);
    expect(totals.promoted).toBe(0);
    expect(router.calls).toHaveLength(0);
  });

  it('T2.4 composite slugs parse cleanly for taleo and eightfold', () => {
    expect(parseAtsBoardSourceId('ats-taleo-valero.taleo.net/2')).toEqual({
      provider: 'taleo',
      board: 'valero.taleo.net/2',
    });
    expect(parseAtsBoardSourceId('ats-eightfold-apply.starbucks.com/starbucks.com')).toEqual({
      provider: 'eightfold',
      board: 'apply.starbucks.com/starbucks.com',
    });
  });

  it('T2.5 malformed payloads throw UNREADABLE and empty Wave 3 feeds return []', () => {
    const eightfold = WAVE3_SPECS.find((s) => s.provider === 'eightfold')!;
    assertProviderContractAndNormalize(eightfold);
    expect(() =>
      normalizeAtsBoard(`ats-eightfold-${eightfold.board}`, '<html>error</html>', {
        observedAt: '2026-11-24T00:00:00Z',
        sourceName: 'Starbucks',
      }),
    ).toThrow();
    const empty = normalizeAtsBoard(
      `ats-eightfold-${eightfold.board}`,
      { data: { positions: [] } },
      { observedAt: '2026-11-24T00:00:00Z', sourceName: 'Starbucks' },
    );
    expect(empty).toEqual([]);
  });

  it('T2.6 missing title or URL items in Wave 3 payloads are filtered cleanly without crashing wave', async () => {
    const huntflow = WAVE3_SPECS.find((s) => s.provider === 'huntflow')!;
    assertProviderContractAndNormalize(huntflow);
    const jobs = normalizeAtsBoard(
      `ats-huntflow-${huntflow.board}`,
      {
        items: [
          { id: 1, position: '', url: 'https://alumnihub-career.huntflow.io/vacancy/1' },
          {
            id: 2,
            position: 'Senior QA Engineer',
            city: 'Warsaw',
            created: '2026-11-24T00:00:00Z',
            url: 'https://alumnihub-career.huntflow.io/vacancy/2',
          },
        ],
      },
      { observedAt: '2026-11-24T00:00:00Z', sourceName: huntflow.company },
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.title).toBe('Senior QA Engineer');
    const src = makeSource({ id: `ats-huntflow-${huntflow.board}`, name: huntflow.company });
    const wrapped = createOfflineEngine({ sources: [src], fetcher: async () => jobs });
    const outcome = await wrapped.engine.syncSource(src.id, undefined, Date.now());
    expect(outcome.kept).toBe(1);
  });
});
