import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { apps, config, noSessions, stores, successProvider } from '../appTestHarness';
import { MatchedPoolPrecompute } from '../vacancies/matchedPoolPrecompute';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';

function pool(size: number): MatchedVacancyItem[] {
  return Array.from({ length: size }, (_, index) => ({
    cluster: {
      id: `warm-${index}`,
      canonicalTitle: `Инженер данных ${index}`,
      canonicalCompany: `Компания ${index}`,
      canonicalLocation: 'Москва',
      isRemote: false,
      skills: [],
      descriptionSummary: 'Описание вакансии.',
      primaryUrl: `https://example.test/${index}`,
      sources: [],
      firstObservedAt: '2026-09-01T00:00:00.000Z',
      lastSeenAt: '2026-09-02T00:00:00.000Z',
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      clusterId: `warm-${index}`,
      roleMatch: 'target',
      requirements: { matched: 1, total: 2 },
      matchingPoints: [],
      missingPoints: [],
      summary: '',
      calculatedAt: '2026-09-02T00:00:00.000Z',
    },
  })) as unknown as MatchedVacancyItem[];
}

async function warmedApp() {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  candidateStore.saveResumeDraft(
    candidate.id,
    { ...EMPTY_RESUME_DRAFT, targetRole: 'Инженер данных' },
    [],
  );
  const engine = {
    getMatchedVacanciesAsync: async () => pool(40),
    restore: () => ({ clusters: 0, sources: 0 }),
  };
  const lines: string[] = [];
  const precompute = new MatchedPoolPrecompute({
    candidateStore,
    engine: engine as never,
    pauseMs: 0,
  });
  const app = await buildApp({
    config: { ...config, logLevel: 'info' },
    coachProvider: successProvider,
    candidateStore,
    authService: noSessions,
    multiSourceVacancyEngine: engine as never,
    matchedPoolPrecompute: precompute,
    serveStatic: false,
    logDestination: { write: (line) => lines.push(line) },
  });
  apps.push(app);
  stores.push(candidateStore);
  precompute.prioritizeCampaign(candidate.id);
  const read = async (query = 'offset=0') => {
    const response = await app.inject({
      url: `/api/v1/candidate/matched-vacancies?${query}`,
      headers: { authorization: `Bearer ${candidate.accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    const timings = lines.map((line) => JSON.parse(line)).filter((line) => line.msg === 'matched-vacancies-timing');
    return timings.at(-1) as { listServed: string; prepareMs: number; listMs: number };
  };
  return { precompute, read, lines };
}

describe('the list is built ahead of the reader (PRB-041)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the first read after a background pass finds the list ready', async () => {
    const { precompute, read } = await warmedApp();

    await precompute.run();

    expect(await read()).toMatchObject({ listServed: 'fresh', prepareMs: 0, listMs: 0 });
  });

  it('a reader back after a break gets the list at once and a new one is built behind them', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { precompute, read } = await warmedApp();
    await precompute.run();

    vi.advanceTimersByTime(5 * 60_000 + 30_000);

    expect(await read()).toMatchObject({ listServed: 'stale', prepareMs: 0, listMs: 0 });
  });

  it('the pass names its cost in the log', async () => {
    const { precompute, lines } = await warmedApp();
    precompute.setLogger({
      info: (fields, message) => lines.push(JSON.stringify({ ...fields, msg: message })),
      error: (fields, message) => lines.push(JSON.stringify({ ...fields, msg: message })),
    });

    await precompute.run();

    const warmed = lines.map((line) => JSON.parse(line)).find((line) => line.msg === 'matched-list-warmed');
    expect(warmed).toMatchObject({
      warmFitIdsMs: expect.any(Number),
      prepareMs: expect.any(Number),
      listMs: expect.any(Number),
      rows: 40,
    });
  });
});
