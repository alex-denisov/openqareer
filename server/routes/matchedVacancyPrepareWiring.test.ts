import { describe, expect, it, vi } from 'vitest';

const prepares = vi.hoisted(() => [] as string[]);
vi.mock('./matchedVacancyFit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./matchedVacancyFit')>();
  return {
    ...actual,
    withWantedCompanyOrder: (...args: Parameters<typeof actual.withWantedCompanyOrder>) => {
      const order = actual.withWantedCompanyOrder(...args);
      return Object.assign((items: Parameters<typeof order>[0]) => order(items), order, {
        prepare: (items: Parameters<typeof order.prepare>[0]) => {
          prepares.push(`prepare:${items.length}`);
          return order.prepare(items);
        },
      });
    },
  };
});

const { buildApp } = await import('../app');
const { SqliteCandidateStore } = await import('../data/sqliteCandidateStore');
const { EMPTY_RESUME_DRAFT } = await import('../domain/resumeDraft');
const { apps, config, noSessions, stores, successProvider } = await import('../appTestHarness');

const pool = Array.from({ length: 40 }, (_, index) => ({
  cluster: {
    id: `row-${index}`,
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
    clusterId: `row-${index}`,
    roleMatch: 'target',
    requirements: { matched: 1, total: 2 },
    matchingPoints: [],
    missingPoints: [],
    summary: 'Совпало 1 из 2 требований вакансии.',
    calculatedAt: '2026-09-02T00:00:00.000Z',
  },
}));

describe('the matched route reads percents ahead of the page build (PRB-041)', () => {
  it('prepares when it builds the list and not when the list cache serves the page', async () => {
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
    const lines: string[] = [];
    const app = await buildApp({
      config: { ...config, logLevel: 'info' },
      logDestination: { write: (line: string) => lines.push(line) },
      coachProvider: successProvider,
      candidateStore,
      authService: noSessions,
      multiSourceVacancyEngine: {
        getMatchedVacanciesAsync: async () => pool,
        restore: () => ({ clusters: 0, sources: 0 }),
      } as never,
      serveStatic: false,
    });
    apps.push(app);
    stores.push(candidateStore);
    const get = (offset: number) =>
      app.inject({
        url: `/api/v1/candidate/matched-vacancies?offset=${offset}`,
        headers: { authorization: `Bearer ${candidate.accessToken}` },
      });

    expect((await get(0)).statusCode).toBe(200);
    expect(prepares).toEqual(['prepare:40']);
    const timings = () =>
      lines.map((line) => JSON.parse(line)).filter((line) => line.msg === 'matched-vacancies-timing');
    expect(timings()[0]).toMatchObject({
      snapshotMs: expect.any(Number),
      prepareMs: expect.any(Number),
      prepareRows: 0,
    });

    expect((await get(20)).statusCode).toBe(200);
    expect((await get(0)).statusCode).toBe(200);
    expect(prepares).toEqual(['prepare:40']);
    expect(timings().at(-1)).toMatchObject({ prepareMs: 0, prepareRows: 0 });
  });
});
