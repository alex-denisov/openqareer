import { expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import {
  ATS_PROVIDERS,
  hasAtsBoardAdapter,
  normalizeAtsBoard,
  parseAtsBoardSourceId,
  type AtsProviderContract,
} from '../../../atsBoardAdapters';
import { checkRepoBoards, publicApiCounter } from '../../../../companyDirectory/freehire/freehireRepoCheck';
import wave1Payloads from '../fixtures/wave1AtsPayloads.json';
import wave2Payloads from '../fixtures/wave2AtsPayloads.json';
import wave3Payloads from '../fixtures/wave3AtsPayloads.json';
import corporateSamples from '../fixtures/corporateHtmlSamples.json';
import { createOfflineEngine, makeSource } from './engineHarness';
import { createMockFetchRouter } from './mockFetch';
import { seedDirectoryCompany, seedPlacement } from './sqliteHarness';

export interface AtsFixtureEntry {
  readonly company: string;
  readonly board: string;
  readonly payload: unknown;
}

export interface AtsWaveSpec {
  readonly wave: 1 | 2 | 3 | 'excluded';
  readonly provider: string;
  readonly company: string;
  readonly board: string;
  readonly payload: unknown;
}

function toSpecs(
  wave: AtsWaveSpec['wave'],
  raw: Record<string, AtsFixtureEntry>,
  excludeKeys: readonly string[] = [],
): AtsWaveSpec[] {
  return Object.entries(raw)
    .filter(([provider]) => !excludeKeys.includes(provider))
    .map(([provider, entry]) => ({
      wave,
      provider,
      company: entry.company,
      board: entry.board,
      payload: entry.payload,
    }));
}

export const WAVE1_SPECS: readonly AtsWaveSpec[] = toSpecs(1, wave1Payloads as Record<string, AtsFixtureEntry>);
export const WAVE2_SPECS: readonly AtsWaveSpec[] = toSpecs(2, wave2Payloads as Record<string, AtsFixtureEntry>);
export const WAVE3_SPECS: readonly AtsWaveSpec[] = toSpecs(
  3,
  wave3Payloads as Record<string, AtsFixtureEntry>,
  ['paycom'],
);
export const PAYCOM_SPEC: AtsWaveSpec = {
  wave: 'excluded',
  provider: 'paycom',
  ...(wave3Payloads as Record<string, AtsFixtureEntry>).paycom,
};
export const CORPORATE_SAMPLES = corporateSamples;

export function findAtsContract(provider: string): AtsProviderContract | undefined {
  return ATS_PROVIDERS.find((p) => (p.provider as string) === provider);
}

export function assertProviderContractAndNormalize(spec: AtsWaveSpec): {
  readonly sourceId: string;
  readonly contract: AtsProviderContract;
  readonly jobs: ReturnType<typeof normalizeAtsBoard>;
} {
  const contract = findAtsContract(spec.provider);
  expect(contract, `Missing ATS_PROVIDERS contract for ${spec.provider}`).toBeDefined();
  expect(contract!.crawlPermission).toBe('allowed');
  expect(contract!.endpoint(spec.board)).toMatch(/^https:\/\//);
  expect(contract!.boardUrl(spec.board)).toMatch(/^https:\/\//);

  const sourceId = `ats-${spec.provider}-${spec.board}`;
  expect(hasAtsBoardAdapter(sourceId)).toBe(true);
  expect(parseAtsBoardSourceId(sourceId)).toEqual({ provider: spec.provider, board: spec.board });

  const jobs = normalizeAtsBoard(sourceId, spec.payload, {
    observedAt: '2026-11-24T12:00:00Z',
    sourceName: spec.company,
  });
  expect(jobs.length).toBeGreaterThanOrEqual(1);
  for (const job of jobs) {
    expect(job.title.length).toBeGreaterThan(2);
    expect(job.company.length).toBeGreaterThan(1);
    expect(job.url).toMatch(/^https:\/\//);
    expect(job.provenance.sourceId).toBe(sourceId);
  }
  return { sourceId, contract: contract!, jobs };
}

export async function assertProviderEngineSync(
  spec: AtsWaveSpec,
  robotsBody = 'User-agent: *\nAllow: /\n',
): Promise<void> {
  const { sourceId, contract } = assertProviderContractAndNormalize(spec);
  const src = makeSource({
    id: sourceId,
    name: spec.company,
    type: 'json_api',
    enabled: true,
    targetUrl: contract.endpoint(spec.board),
  });
  const wrapped = createOfflineEngine({
    sources: [src],
    fetchRobots: async () => ({ status: 200, body: robotsBody }),
    fetcher: async () =>
      normalizeAtsBoard(sourceId, spec.payload, {
        observedAt: '2026-11-24T12:00:00Z',
        sourceName: spec.company,
      }),
  });
  try {
    const outcome = await wrapped.engine.syncSource(sourceId, undefined, Date.UTC(2026, 10, 24, 12));
    expect(outcome.status).toBe('healthy');
    expect(outcome.kept).toBeGreaterThanOrEqual(1);
    const page = wrapped.engine.getVacancies({ sourceId });
    expect(page.total).toBeGreaterThanOrEqual(1);
  } finally {
    wrapped.close();
  }
}

export async function assertProviderFreehireRepoCheck(
  db: DatabaseSync,
  spec: AtsWaveSpec,
): Promise<void> {
  const companyKey = `fh-${spec.provider}-${spec.board.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
  const placementId = `ats:${spec.provider}:${spec.board.toLowerCase()}`;
  seedDirectoryCompany(db, {
    companyKey,
    companyName: spec.company,
    sourceType: 'linkedin_guest',
  });
  seedPlacement(db, {
    placementId,
    companyKey,
    type: 'ats',
    provider: spec.provider,
    slug: spec.board,
    discoveredBy: 'freehire',
  });
  const router = createMockFetchRouter(
    [{ match: () => true, respond: { status: 200, body: spec.payload } }],
  );
  const totals = await checkRepoBoards(db, publicApiCounter(router.fetch), 20, 1000, () => Date.UTC(2026, 10, 24));
  expect(totals.promoted).toBe(1);
  const row = db
    .prepare('SELECT ats_provider, ats_slug, source_type FROM company_directory WHERE company_key = ?')
    .get(companyKey) as { ats_provider: string | null; ats_slug: string | null; source_type: string } | undefined;
  expect(row?.ats_provider).toBe(spec.provider);
  expect(row?.source_type).toBe('ats_direct');
}
