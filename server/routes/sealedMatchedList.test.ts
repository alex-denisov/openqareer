import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { apps, config, noSessions, stores, successProvider } from '../appTestHarness';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { watchWriteHolds } from '../observability/sqliteWriteHolds';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { forgetMatchedListsForTests, MATCHED_LIST_MAX_AGE_MS, readSealedMatchedList, sealMatchedList } from './matchedVacancyList';
import { SEALED_MATCHED_LIST_MAX_BYTES, SEALED_MATCHED_LIST_VERSION, sealedListText } from './sealedMatchedList';

const row = (id: string, summary = 'Описание вакансии.') =>
  ({
    cluster: {
      id,
      canonicalTitle: `Инженер данных ${id}`,
      canonicalCompany: `Компания ${id}`,
      canonicalLocation: 'Москва',
      isRemote: false,
      skills: [],
      descriptionSummary: summary,
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
      summary: '',
      calculatedAt: '2026-09-02T00:00:00.000Z',
    },
  }) as unknown as MatchedVacancyItem;

const pool = (size: number) => Array.from({ length: size }, (_, index) => row(`v-${index}`));

async function sealedApp(rows = pool(40)) {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  candidateStore.saveResumeDraft(candidate.id, { ...EMPTY_RESUME_DRAFT, targetRole: 'Инженер данных' }, []);
  const engine = {
    rows,
    calls: 0,
    getMatchedVacanciesAsync: vi.fn(async () => {
      engine.calls += 1;
      return engine.rows;
    }),
    restore: () => ({ clusters: 0, sources: 0 }),
  };
  const lines: string[] = [];
  const app = await buildApp({
    config: { ...config, logLevel: 'info' },
    coachProvider: successProvider,
    candidateStore,
    authService: noSessions,
    multiSourceVacancyEngine: engine as never,
    serveStatic: false,
    logDestination: { write: (line) => lines.push(line) },
  });
  apps.push(app);
  stores.push(candidateStore);
  const read = async (query = 'offset=0') => {
    const response = await app.inject({
      url: `/api/v1/candidate/matched-vacancies?${query}`,
      headers: { authorization: `Bearer ${candidate.accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    const timing = lines.map((line) => JSON.parse(line)).filter((line) => line.msg === 'matched-vacancies-timing').at(-1);
    const body = response.json() as { data: { cluster: { id: string } }[]; meta: { total: number } };
    return { timing, ids: body.data.map((item) => item.cluster.id), total: body.meta.total };
  };
  const logged = (message: string) => lines.map((line) => JSON.parse(line)).filter((line) => line.msg === message);
  return { app, candidateStore, candidate, engine, read, logged };
}

const settle = async (logged: (message: string) => unknown[], message: string, count = 1) => {
  await vi.waitFor(() => expect(logged(message).length).toBeGreaterThanOrEqual(count));
};

describe('the first read of a new process answers from the sealed list (PRB-055)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    forgetMatchedListsForTests();
  });

  it('gives the same page without waiting for the pool, and the journal names the phase', async () => {
    const { read, engine } = await sealedApp();
    const live = await read();

    forgetMatchedListsForTests();
    engine.getMatchedVacanciesAsync.mockImplementation(() => new Promise(() => undefined));
    const sealed = await read();

    expect(sealed.timing).toMatchObject({ listServed: 'sealed', sealedReadMs: expect.any(Number) });
    expect(sealed.timing.snapshotMs).toBeUndefined();
    expect(sealed.ids).toEqual(live.ids);
    expect(sealed.total).toBe(live.total);
  });

  it('does not open the stored results on the sealed path', async () => {
    const { read } = await sealedApp();
    await read();
    forgetMatchedListsForTests();

    expect((await read()).timing.warmFitIdsMs).toBeUndefined();
  });

  it('builds the real list behind the answer, and then the usual read takes over', async () => {
    const { read, logged } = await sealedApp();
    await read();
    forgetMatchedListsForTests();

    expect((await read()).timing.listServed).toBe('sealed');
    await settle(logged, 'matched-list-warmed');

    expect((await read()).timing.listServed).not.toBe('sealed');
  });

  it('a profile the candidate changed is not answered by the old list', async () => {
    const { read, candidateStore, candidate } = await sealedApp();
    await read();
    forgetMatchedListsForTests();
    candidateStore.saveResumeDraft(candidate.id, { ...EMPTY_RESUME_DRAFT, targetRole: 'Повар' }, []);

    expect((await read()).timing.listServed).toBe('built');
  });

  it('another filter or sort is not answered by the old list', async () => {
    const { read } = await sealedApp();
    await read();
    forgetMatchedListsForTests();
    expect((await read('offset=0&remote=1')).timing.listServed).toBe('built');
    forgetMatchedListsForTests();
    expect((await read('offset=0&sort=money')).timing.listServed).toBe('built');
  });

  it('a row of another version is not served, and a later page beyond the stored ones goes the usual way', async () => {
    const { read, candidateStore, candidate } = await sealedApp(pool(400));
    await read();
    forgetMatchedListsForTests();
    expect((await read('offset=390')).timing.listServed).toBe('built');

    forgetMatchedListsForTests();
    const stored = candidateStore.sealedMatchedLists.read(candidate.id, 0)!;
    const older = { ...JSON.parse(stored.text), version: SEALED_MATCHED_LIST_VERSION - 1 };
    candidateStore.sealedMatchedLists.write(candidate.id, Date.now(), JSON.stringify(older));
    expect((await read()).timing.listServed).toBe('built');
  });

  it('a closed vacancy stays in the stored list no longer than in a held one: same limit, downtime counts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const before = await sealedApp();
    await before.read();
    before.engine.rows = pool(40).slice(1);
    forgetMatchedListsForTests();
    vi.advanceTimersByTime(MATCHED_LIST_MAX_AGE_MS - 1);
    expect((await before.read()).ids).toContain('v-0');
    await settle(before.logged, 'matched-list-warmed');
    forgetMatchedListsForTests();

    const after = await sealedApp();
    await after.read();
    after.engine.rows = pool(40).slice(1);
    forgetMatchedListsForTests();
    vi.advanceTimersByTime(MATCHED_LIST_MAX_AGE_MS);
    const cold = await after.read();
    // Past the limit the stored list does not answer; the read goes to the pool as any other.
    expect(cold.timing.listServed).toBe('built');
  });

  it('a held list at the same age is rebuilt too: the limit is the same number', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { read } = await sealedApp();
    await read();
    vi.advanceTimersByTime(MATCHED_LIST_MAX_AGE_MS);
    expect((await read()).timing.listServed).toBe('built');
  });

  it('goes with the account and holds no readable text', async () => {
    const { read, candidateStore, candidate } = await sealedApp();
    await read();
    const database = (candidateStore as never as { database: import('node:sqlite').DatabaseSync }).database;
    const cipher = database.prepare('SELECT cipher FROM sealed_matched_lists').get() as { cipher: string };
    expect(cipher.cipher).not.toContain('Инженер');

    candidateStore.deleteCandidate(candidate.id);

    expect(database.prepare('SELECT COUNT(*) AS n FROM sealed_matched_lists').get()).toEqual({ n: 0 });
  });

  it('a write is one short transaction per build, and the journal has its length', async () => {
    const holds: string[] = [];
    const stop = watchWriteHolds((hold) => {
      if (hold.statement.includes('sealed_matched_lists')) holds.push(hold.statement);
    }, 0);
    try {
      const { read, logged } = await sealedApp();
      await read();
      await read();
      expect(holds).toEqual(['INSERT INTO sealed_matched_lists']);
      expect(logged('matched-list-sealed')[0]).toMatchObject({
        heldMs: expect.any(Number),
        lockWaitMs: expect.any(Number),
        bytes: expect.any(Number),
        rows: 40,
      });
    } finally {
      stop();
    }
  });

  it('an older build does not replace a newer one', async () => {
    const { candidateStore, candidate } = await sealedApp();
    candidateStore.sealedMatchedLists.write(candidate.id, 2_000, 'newer');
    candidateStore.sealedMatchedLists.write(candidate.id, 1_000, 'older');
    expect(candidateStore.sealedMatchedLists.read(candidate.id, 0)).toEqual({ builtAt: 2_000, text: 'newer' });
  });

  it('keeps the first pages of a long list, and nothing when even they would not be short', () => {
    const list = (rows: MatchedVacancyItem[]) =>
      ({ filtered: rows, pageOffsets: rows.map((_, index) => index), facets: {}, campaignWithHypotheses: {} }) as never;
    const text = sealedListText(list(pool(50)), 'c');
    expect(JSON.parse(text!).pages).toHaveLength(5);
    expect(JSON.parse(text!).total).toBe(50);

    const huge = { filtered: pool(1), pageOffsets: [0], facets: { huge: 'x'.repeat(SEALED_MATCHED_LIST_MAX_BYTES) }, campaignWithHypotheses: {} } as never;
    expect(sealedListText(huge, 'c')).toBeUndefined();
    expect(sealedListText(list([]), 'c')).toBeUndefined();
  });

  it('the switch off stops the write', async () => {
    const { candidateStore, candidate } = await sealedApp();
    const writing = vi.spyOn(candidateStore.sealedMatchedLists, 'write');
    const list = { filtered: pool(1), pageOffsets: [0], facets: {}, campaignWithHypotheses: {} } as never;
    const input = { candidateId: candidate.id, candidateStore } as never;
    sealMatchedList(input, 'c', list, 1, undefined, false);
    expect(writing).not.toHaveBeenCalled();
    sealMatchedList(input, 'c', list, 1, undefined, true);
    expect(writing).toHaveBeenCalledOnce();
  });

  it('the switch off stops the read', async () => {
    const { read, candidateStore, candidate } = await sealedApp();
    await read();
    forgetMatchedListsForTests();
    const input = { candidateId: candidate.id, candidateStore } as never;
    const reading = vi.spyOn(candidateStore.sealedMatchedLists, 'read');
    expect(readSealedMatchedList(input, { enabled: false })).toBeUndefined();
    expect(reading).not.toHaveBeenCalled();
  });
});
