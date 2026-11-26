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
const STATUS = '/api/v1/candidate/status';
const PATH = '/api/v1/candidate/career/profession-path';
const ANSWER = `${PATH}/lower-income`;

afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(engine?: {
  getMatchedVacanciesAsync: (query: unknown) => Promise<unknown[]>;
}) {
  const directory = mkdtempSync(join(tmpdir(), 'oq-profession-'));
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
    ...(engine ? { multiSourceVacancyEngine: engine as never } : {}),
  });
  cleanups.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => candidateStore.close(),
    () => app.close(),
  );
  const apply = (who: 'flagged' | 'plain', title: string, occurredAt: string) =>
    candidateStore.createApplication(principals[who].candidate!.id, {
      stage: 'applied',
      occurredAt,
      manualVacancy: {
        title,
        company: `Компания ${title}`,
        url: `https://example.test/${encodeURIComponent(title)}`,
        source: 'manual',
      },
    });
  return { app, apply };
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

describe('путь в профессию без флага B640', () => {
  it('отвечает как несуществующий адрес', async () => {
    const { app } = await setup();
    const missing = await call(app, 'GET', '/api/v1/candidate/no-such-route', plain);
    for (const [method, url, payload] of [
      ['GET', PATH, undefined],
      ['PUT', ANSWER, { answer: 'yes' }],
    ] as const) {
      for (const token of [plain, undefined]) {
        const response = await call(app, method, url, token, payload);
        expect(response.statusCode, `${method} ${url}`).toBe(404);
        expect(response.json().error.code).toBe(missing.json().error.code);
      }
    }
  });
});

describe('путь в профессию с флагом B640', () => {
  it('без целевой профессии — «цель не выбрана», ответ о доходе не пишется', async () => {
    const { app } = await setup();
    await call(app, 'PUT', STATUS, flagged, { status: 'looking' });
    const response = await call(app, 'GET', PATH, flagged);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ state: 'no_target' });
    const answer = await call(app, 'PUT', ANSWER, flagged, { answer: 'yes' });
    expect(answer.statusCode).toBe(409);
  });

  it('выбор профессии сразу строит её срез: первый заход в «Карьеру» не ждёт холодного чтения (B669)', async () => {
    const getMatchedVacanciesAsync = vi.fn(async () => []);
    const { app } = await setup({ getMatchedVacanciesAsync });
    const changed = await call(app, 'PUT', STATUS, flagged, {
      status: 'changing_profession',
      targetProfession: 'Продакт-менеджер',
    });
    expect(changed.statusCode).toBe(200);
    await vi.waitFor(() =>
      expect(getMatchedVacanciesAsync).toHaveBeenCalledWith(
        expect.objectContaining({ targetRoles: ['Продакт-менеджер'] }),
      ),
    );
  });

  it('статус без профессии срез не строит (B669)', async () => {
    const getMatchedVacanciesAsync = vi.fn(async () => []);
    const { app } = await setup({ getMatchedVacanciesAsync });
    await call(app, 'PUT', STATUS, flagged, { status: 'looking' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getMatchedVacanciesAsync).not.toHaveBeenCalled();
  });

  it('отдаёт падежные формы профессии из словаря, без них — null (B669)', async () => {
    const { app } = await setup({ getMatchedVacanciesAsync: vi.fn(async () => []) });
    const read = async (targetProfession: string) => {
      await call(app, 'PUT', STATUS, flagged, { status: 'changing_profession', targetProfession });
      return (await call(app, 'GET', PATH, flagged)).json().data;
    };
    expect(await read('Продакт-менеджер')).toMatchObject({
      state: 'too_few',
      forms: { toBecome: 'продакт-менеджеры', genitive: 'продакта', instrumental: 'продактом' },
    });
    expect(await read('Сомелье')).toMatchObject({ state: 'too_few', forms: null });
  });

  it('с целевой профессией отдаёт её и принимает ответ о доходе', async () => {
    const { app } = await setup();
    const changed = await call(app, 'PUT', STATUS, flagged, {
      status: 'changing_profession',
      targetProfession: 'Продакт-менеджер',
    });
    expect(changed.statusCode).toBe(200);
    const response = await call(app, 'GET', PATH, flagged);
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.target).toBe('Продакт-менеджер');
    expect(['ready', 'too_few', 'source_unavailable']).toContain(data.state);
    expect((await call(app, 'PUT', ANSWER, flagged, { answer: 'maybe' })).statusCode).toBe(400);
    const answer = await call(app, 'PUT', ANSWER, flagged, { answer: 'depends' });
    expect(answer.statusCode).toBe(200);
    expect(answer.json().data).toEqual({ lowerIncome: 'depends' });
  });
});
