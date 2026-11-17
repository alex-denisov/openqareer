import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { signalApplicationOf } from './statusSignalRoutes';

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const ORIGIN = 'http://localhost:3000';
const STATUS = '/api/v1/candidate/status';
const SIGNAL = `${STATUS}/signal`;

afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-signal-'));
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
const NEW_ROUTES: ReadonlyArray<['GET' | 'POST', string, unknown?]> = [
  ['GET', SIGNAL],
  ['POST', `${SIGNAL}/answer`, { kind: 'started_search', answer: 'no' }],
  ['POST', `${SIGNAL}/answer/undo`],
];

/** Кандидат «Присматриваюсь» уже 20 дней и только что сам откликнулся на две вакансии. */
async function lookingWithTwoApplications() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T09:00:00.000Z'));
  const context = await setup();
  const changed = await call(context.app, 'PUT', STATUS, flagged, { status: 'looking' });
  expect(changed.statusCode).toBe(200);
  vi.setSystemTime(new Date('2026-11-16T09:00:00.000Z'));
  context.apply('flagged', 'Backend Developer', '2026-11-15T10:00:00.000Z');
  context.apply('flagged', 'Golang Developer', '2026-11-14T10:00:00.000Z');
  return context;
}

describe('маршруты сигналов без флага B640', () => {
  it('отвечают как несуществующий адрес и ничего не пишут', async () => {
    const { app, apply } = await setup();
    apply('plain', 'Backend Developer', new Date(Date.now() - 86_400_000).toISOString());
    const missing = await call(app, 'GET', '/api/v1/candidate/no-such-route', plain);
    for (const [method, url, payload] of NEW_ROUTES) {
      for (const token of [plain, undefined]) {
        const response = await call(app, method, url, token, payload);
        expect(response.statusCode, `${method} ${url}`).toBe(404);
        expect(response.json().error.code).toBe(missing.json().error.code);
      }
    }
  });

  it('прежний «Сегодня» отвечает тем же набором полей', async () => {
    const { app } = await setup();
    const before = await call(app, 'GET', '/api/v1/candidate/today?tz=Europe/Moscow', plain);
    const withFlag = await call(app, 'GET', '/api/v1/candidate/today?tz=Europe/Moscow', flagged);
    expect(before.statusCode).toBe(200);
    expect(Object.keys(withFlag.json().data)).toEqual(Object.keys(before.json().data));
  });
});

describe('маршруты сигналов с флагом B640', () => {
  it('без поводов сигнала нет', async () => {
    const { app } = await setup();
    const response = await call(app, 'GET', SIGNAL, flagged);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ signal: null, answered: null });
  });

  it('показывает сигнал с фактами после двух своих откликов', async () => {
    const { app } = await lookingWithTwoApplications();
    const { signal } = (await call(app, 'GET', SIGNAL, flagged)).json().data;
    expect(signal.kind).toBe('started_search');
    expect(signal.facts[0]).toBe('2 отклика за неделю, раньше 0');
    expect(signal.suggest).toEqual({ status: 'job_search', targetProfession: null });
  });

  it('«Нет» прячет сигнал, «Отменить ответ» возвращает; статус не меняется', async () => {
    const { app } = await lookingWithTwoApplications();
    const no = await call(app, 'POST', `${SIGNAL}/answer`, flagged, {
      kind: 'started_search',
      answer: 'no',
    });
    expect(no.statusCode).toBe(200);
    expect(no.json().data.signal).toBeNull();
    expect(no.json().data.answered).toMatchObject({ kind: 'started_search', answer: 'no' });
    const undo = await call(app, 'POST', `${SIGNAL}/answer/undo`, flagged);
    expect(undo.statusCode).toBe(200);
    expect(undo.json().data.signal.kind).toBe('started_search');
    const again = await call(app, 'POST', `${SIGNAL}/answer/undo`, flagged);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('status_signal_undo_unavailable');
    const status = await call(app, 'GET', STATUS, flagged);
    expect(status.json().data.current.status).toBe('looking');
  });

  it('отклоняет чужой сигнал, неизвестный ответ и лишние поля', async () => {
    const { app } = await lookingWithTwoApplications();
    const other = await call(app, 'POST', `${SIGNAL}/answer`, flagged, {
      kind: 'changing_profession',
      answer: 'no',
    });
    expect(other.statusCode).toBe(409);
    expect(other.json().error.code).toBe('status_signal_not_active');
    for (const payload of [
      { kind: 'started_search', answer: 'maybe' },
      { kind: 'x', answer: 'no' },
      { kind: 'started_search', answer: 'no', candidateId: 'x' },
      {},
    ]) {
      const bad = await call(app, 'POST', `${SIGNAL}/answer`, flagged, payload);
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.code).toBe('invalid_status_signal_answer');
    }
  });

  it('отклики другого кандидата сигнал не поднимают', async () => {
    const { app, apply } = await setup();
    apply('plain', 'Backend Developer', new Date(Date.now() - 86_400_000).toISOString());
    apply('plain', 'Golang Developer', new Date(Date.now() - 2 * 86_400_000).toISOString());
    expect((await call(app, 'GET', SIGNAL, flagged)).json().data.signal).toBeNull();
  });

  it('«Сегодня» по статусу отдаёт дату выбора статуса', async () => {
    const { app } = await lookingWithTwoApplications();
    const today = (await call(app, 'GET', `${STATUS}/today`, flagged)).json().data.today;
    expect(today.since).toBe('2026-10-27T09:00:00.000Z');
    const { app: fresh } = await setup();
    expect(
      (await call(fresh, 'GET', `${STATUS}/today`, flagged)).json().data.today.since,
    ).toBeNull();
  });
});

describe('отклик как довод сигнала', () => {
  const view = {
    id: 'a1',
    clusterId: null,
    stage: 'applied',
    vacancy: { title: 'Product Manager', company: 'x', url: 'u', source: 's' },
    createdAt: '2026-11-10T10:00:00.000Z',
    stageChangedAt: '2026-11-12T10:00:00.000Z',
    appliedAt: '2026-11-11T10:00:00.000Z',
  } as never;

  it('берёт направление из названия и время отклика', () => {
    expect(signalApplicationOf(view, new Set())).toEqual({
      id: 'a1',
      vacancyKey: 'a1',
      functionCode: 'product',
      stage: 'applied',
      createdAt: '2026-11-10T10:00:00.000Z',
      appliedAt: '2026-11-11T10:00:00.000Z',
      stageChangedAt: '2026-11-12T10:00:00.000Z',
      automatic: false,
    });
  });

  it('архив: с откликом — отклик, без отклика — нет', () => {
    const sent = {
      ...(view as object),
      stage: 'archived',
      reachedStages: ['saved', 'applied'],
    } as never;
    expect(signalApplicationOf(sent, new Set()).appliedAt).toBe('2026-11-11T10:00:00.000Z');
    const dropped = { ...(view as object), stage: 'archived', reachedStages: ['saved'] } as never;
    expect(signalApplicationOf(dropped, new Set()).appliedAt).toBeNull();
  });

  it('сохранённая вакансия — не отклик; автоотклик помечен; без названия направления нет', () => {
    const saved = signalApplicationOf(
      { ...(view as object), stage: 'saved', clusterId: 'c1' } as never,
      new Set(),
    );
    expect(saved).toMatchObject({ vacancyKey: 'c1', appliedAt: null });
    expect(signalApplicationOf(view, new Set(['a1'])).automatic).toBe(true);
    expect(
      signalApplicationOf({ ...(view as object), vacancy: null } as never, new Set()).functionCode,
    ).toBeNull();
  });
});
