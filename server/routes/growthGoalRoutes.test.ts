import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const ORIGIN = 'http://localhost:3000';
const PATH = '/api/v1/candidate/career/growth';
const GOAL = `${PATH}/goal`;

afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-growth-'));
  const config = {
    ...baseConfig,
    databasePath: join(directory, 'test.sqlite'),
    cabinetB640Usernames: ['flagged.test'],
  };
  const candidateStore = new SqliteCandidateStore({
    databasePath: config.databasePath,
    encryptionKey: config.dataEncryptionKey,
  });
  const principal = (username: string): AuthPrincipal => ({
    userId: `user-${username}`,
    username,
    email: null,
    displayName: null,
    role: 'candidate',
    isTest: true,
    candidate: candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' }),
  });
  const principals = { flagged: principal('flagged.test'), plain: principal('plain.test') };
  const sessions = new Map([
    ['token-flagged', principals.flagged],
    ['token-plain', principals.plain],
  ]);
  const authService: SessionAuth = {
    ...noSessions,
    authenticate: (token: string) => sessions.get(token) ?? null,
  };
  const app = await buildApp({
    config,
    candidateStore,
    authService,
    coachProvider: {} as never,
    serveStatic: false,
  });
  cleanups.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => candidateStore.close(),
    () => app.close(),
  );
  const id = principals.flagged.candidate!.id;
  return { app, candidateStore, id };
}

function call(
  app: App,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  token?: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: ORIGIN },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

const flagged = 'token-flagged';
const plain = 'token-plain';

describe('цель роста без флага B640', () => {
  it('отвечает как несуществующий адрес', async () => {
    const { app } = await setup();
    const missing = await call(app, 'GET', '/api/v1/candidate/no-such-route', plain);
    for (const [method, url, payload] of [
      ['GET', PATH, undefined],
      ['PUT', GOAL, { goal: 'raise' }],
    ] as const) {
      for (const token of [plain, undefined]) {
        const response = await call(app, method, url, token, payload);
        expect(response.statusCode, `${method} ${url}`).toBe(404);
        expect(response.json().error.code).toBe(missing.json().error.code);
      }
    }
  });
});

describe('цель роста с флагом B640', () => {
  it('без места работы цель не ставится', async () => {
    const { app } = await setup();
    expect((await call(app, 'GET', PATH, flagged)).json().data).toEqual({ state: 'no_workplace' });
    expect((await call(app, 'PUT', GOAL, flagged, { goal: 'raise' })).statusCode).toBe(409);
  });

  it('без цели — «цель не задана», выбор и смена цели хранят дату выбора', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-12T09:00:00.000Z'));
    const { app, candidateStore, id } = await setup();
    candidateStore.careerDiaryRepo.createWorkplace(id, {
      company: 'Вектор Банк',
      title: 'Руководитель разработки',
      startDate: '2025-09-01',
    });
    candidateStore.diaryEntryRepo.create(
      id,
      { date: '2026-01-03', kind: 'result', text: 'Выпуск релиза: с 14 до 5 дней' },
      'entry-1',
    );
    const empty = await call(app, 'GET', PATH, flagged);
    expect(empty.json().data).toEqual({
      state: 'no_goal',
      company: 'Вектор Банк',
      title: 'Руководитель разработки',
    });
    expect((await call(app, 'PUT', GOAL, flagged, { goal: 'boss' })).statusCode).toBe(400);
    const chosen = await call(app, 'PUT', GOAL, flagged, { goal: 'promotion' });
    expect(chosen.statusCode).toBe(200);
    expect(chosen.json().data.goal).toEqual({
      kind: 'promotion',
      chosenAt: '2026-01-12T09:00:00.000Z',
    });
    const ready = (await call(app, 'GET', PATH, flagged)).json().data;
    expect(ready.state).toBe('ready');
    expect(ready.goal.kind).toBe('promotion');
    expect(ready.arguments).toEqual([
      expect.objectContaining({
        text: 'Выпуск релиза: с 14 до 5 дней',
        source: 'Дневник, 3 января',
      }),
    ]);
    for (const step of ready.steps) expect(step.source).toBeTruthy();
    vi.setSystemTime(new Date('2026-02-01T09:00:00.000Z'));
    await call(app, 'PUT', GOAL, flagged, { goal: 'raise' });
    const changed = (await call(app, 'GET', PATH, flagged)).json().data;
    expect(changed.goal).toEqual({ kind: 'raise', chosenAt: '2026-02-01T09:00:00.000Z' });
  });
});
