import { afterEach, describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => ({
  hold: undefined as Promise<void> | undefined,
  prepares: 0,
}));
vi.mock('./matchedVacancyFit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./matchedVacancyFit')>();
  return {
    ...actual,
    withWantedCompanyOrder: (...args: Parameters<typeof actual.withWantedCompanyOrder>) => {
      const order = actual.withWantedCompanyOrder(...args);
      return Object.assign((items: Parameters<typeof order>[0]) => order(items), order, {
        prepare: async (items: Parameters<typeof order.prepare>[0]) => {
          gate.prepares += 1;
          await gate.hold;
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

const row = (id: string, remote = false) => ({
  cluster: {
    id,
    canonicalTitle: `Инженер данных ${id}`,
    canonicalCompany: `Компания ${id}`,
    canonicalLocation: 'Москва',
    isRemote: remote,
    skills: [],
    descriptionSummary: 'Описание вакансии.',
    primaryUrl: `https://example.test/${id}`,
    sources: [],
    firstObservedAt: '2026-09-01T00:00:00.000Z',
    lastSeenAt: '2026-09-02T00:00:00.000Z',
    status: 'active',
    vacanciesCount: 1,
  },
  explanation: {
    clusterId: id,
    roleMatch: 'target',
    requirements: { matched: 1, total: 2 },
    matchingPoints: [],
    missingPoints: [],
    summary: 'Совпало 1 из 2 требований вакансии.',
    calculatedAt: '2026-09-02T00:00:00.000Z',
  },
});
const pool = [row('a'), row('b'), row('c', true)];

async function setup() {
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
  const get = async (query = 'offset=0') => {
    const response = await app.inject({
      url: `/api/v1/candidate/matched-vacancies?${query}`,
      headers: { authorization: `Bearer ${candidate.accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    return response.json<{
      data: ReadonlyArray<{ cluster: { id: string } }>;
      meta: { total: number };
    }>();
  };
  const logged = (message: string) =>
    lines.map((line) => JSON.parse(line)).filter((line) => line.msg === message);
  return { candidateStore, candidate, get, logged };
}

const WINDOW_MS = 60_000;
const settle = () => new Promise((resolve) => setImmediate(resolve));
const idsOf = (page: { data: ReadonlyArray<{ cluster: { id: string } }> }) =>
  page.data.map((item) => item.cluster.id).sort();

function advanceClock(byMs: number) {
  const realNow = Date.now.bind(Date);
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + byMs);
}

afterEach(() => {
  vi.restoreAllMocks();
  gate.hold = undefined;
  gate.prepares = 0;
});

describe('the matched list past its window (PRB-041)', () => {
  it('answers with the old list while the new one waits, then serves the new one', async () => {
    const { get, logged } = await setup();
    await get();
    advanceClock(WINDOW_MS + 1);
    let release!: () => void;
    gate.hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    const answered = await Promise.race([
      get().then(() => 'answered'),
      new Promise((resolve) => setTimeout(() => resolve('held by the build'), 500)),
    ]);
    expect(answered).toBe('answered');
    expect(logged('matched-vacancies-timing').at(-1)).toMatchObject({
      listCached: true,
      listServed: 'stale',
      prepareMs: 0,
    });

    release();
    await vi.waitFor(() => expect(logged('matched-list-rebuilt')).toHaveLength(1));
    expect(logged('matched-list-rebuilt')[0]).toMatchObject({
      listMs: expect.any(Number),
      prepareMs: expect.any(Number),
    });
    await get();
    expect(logged('matched-vacancies-timing').at(-1)).toMatchObject({ listServed: 'fresh' });
  });

  it('starts one rebuild for many reads past the window', async () => {
    const { get } = await setup();
    await get();
    const before = gate.prepares;
    advanceClock(WINDOW_MS + 1);
    let release!: () => void;
    gate.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await Promise.all([get(), get(), get()]);
    await get('offset=0');
    release();
    await settle();
    expect(gate.prepares - before).toBe(1);
  });

  it('a read past the age limit waits for a new list instead of the old one', async () => {
    const { get, logged } = await setup();
    await get();
    advanceClock(5 * 60_000 + 1);
    await get();
    expect(logged('matched-vacancies-timing').at(-1)).toMatchObject({
      listCached: false,
      listServed: 'built',
    });
  });
});

describe('candidate actions reach the list at once (PRB-041)', () => {
  it('a skipped vacancy leaves the very next read, inside the window', async () => {
    const { candidateStore, candidate, get, logged } = await setup();
    expect(idsOf(await get())).toEqual(['a', 'b', 'c']);
    candidateStore.createVacancySkip(candidate.id, {
      clusterId: 'b',
      reasonId: 'level',
      origin: 'vacancy_card',
    });
    const next = await get();
    expect(idsOf(next)).toEqual(['a', 'c']);
    expect(next.meta.total).toBe(2);
    expect(logged('matched-vacancies-timing').at(-1)).toMatchObject({ listServed: 'built' });
  });

  it('a skipped vacancy leaves the next read past the window too, never served stale', async () => {
    const { candidateStore, candidate, get } = await setup();
    await get();
    advanceClock(WINDOW_MS + 1);
    candidateStore.createVacancySkip(candidate.id, {
      clusterId: 'a',
      reasonId: 'level',
      origin: 'vacancy_card',
    });
    expect(idsOf(await get())).toEqual(['b', 'c']);
  });

  it('another filter answers from its own list, not the old one', async () => {
    const { get } = await setup();
    await get();
    expect(idsOf(await get('offset=0&remote=1'))).toEqual(['c']);
    expect(idsOf(await get())).toEqual(['a', 'b', 'c']);
  });
});
