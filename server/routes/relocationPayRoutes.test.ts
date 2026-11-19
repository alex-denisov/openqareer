import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { DatabaseSync } from 'node:sqlite';

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const ORIGIN = 'http://localhost:3000';
const PATH = '/api/v1/candidate/career/relocation/pay';

afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-relocation-pay-'));
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
  return { app, databasePath: config.databasePath };
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

function storeStats(databasePath: string, key: string, sample: number) {
  const database = new DatabaseSync(databasePath);
  database.exec(
    'CREATE TABLE IF NOT EXISTS catalog_salary_stats (list_key TEXT PRIMARY KEY, payload TEXT NOT NULL, computed_at TEXT NOT NULL) STRICT',
  );
  const groups = [
    { currency: 'RUB', period: 'month', sample, median: 390_000, low: 330_000, high: 450_000 },
  ];
  database
    .prepare('INSERT INTO catalog_salary_stats VALUES (?, ?, ?)')
    .run(
      key,
      JSON.stringify({ withSalary: sample, withRange: sample, groups }),
      '2026-11-18T03:00:00.000Z',
    );
  database.close();
}

describe('вилки релокации без флага B640', () => {
  it('отвечают как несуществующий адрес', async () => {
    const { app } = await setup();
    const missing = await call(app, 'GET', '/api/v1/candidate/no-such-route', plain);
    for (const token of [plain, undefined]) {
      const response = await call(app, 'GET', `${PATH}?country=RS`, token);
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe(missing.json().error.code);
    }
  });
});

describe('вилки релокации с флагом B640', () => {
  it('проверяет запрос: страна или город, страна из списка расчёта', async () => {
    const { app } = await setup();
    expect((await call(app, 'GET', PATH, flagged)).statusCode).toBe(400);
    expect((await call(app, 'GET', `${PATH}?country=RS&city=Казань`, flagged)).statusCode).toBe(
      400,
    );
    expect((await call(app, 'GET', `${PATH}?country=XX`, flagged)).statusCode).toBe(404);
  });

  it('страна без каталога — «мало данных», не число', async () => {
    const { app } = await setup();
    const response = await call(app, 'GET', `${PATH}?country=RS`, flagged);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ state: 'thin' });
  });

  it('город России: вилка роли с выборкой и датой, иначе весь город, иначе «мало данных»', async () => {
    const { app, databasePath } = await setup();
    const kazan = `${PATH}?city=${encodeURIComponent('Казань')}`;
    expect((await call(app, 'GET', kazan, flagged)).json().data).toEqual({ state: 'thin' });
    storeStats(databasePath, 'kazan', 120);
    const city = (
      await call(
        app,
        'GET',
        `${kazan}&role=${encodeURIComponent('Руководитель разработки')}`,
        flagged,
      )
    ).json().data;
    expect(city).toEqual({
      state: 'ready',
      scope: 'city',
      currency: 'RUB',
      low: 330_000,
      median: 390_000,
      high: 450_000,
      sampleSize: 120,
      observedAt: '2026-11-18T03:00:00.000Z',
    });
  });
});
