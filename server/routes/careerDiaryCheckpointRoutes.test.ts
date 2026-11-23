import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { SqliteDiaryDetailsRepository } from '../data/sqliteDiaryDetailsRepository';

type App = Awaited<ReturnType<typeof buildApp>>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const cleanups: Array<() => Promise<void> | void> = [];
const DIARY = '/api/v1/candidate/career-diary';
const flagged = 'token-flagged';
const other = 'token-other';
const plain = 'token-plain';
const SOME_ID = '00000000-0000-4000-8000-000000000001';
const SLOW = 60_000;

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-diary-checks-'));
  const config = {
    ...baseConfig,
    databasePath: join(directory, 'test.sqlite'),
    cabinetB640Usernames: ['flagged.test', 'other.test'],
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
  const sessions = new Map([
    [flagged, principal('flagged.test')],
    [other, principal('other.test')],
    [plain, principal('plain.test')],
  ]);
  const authService: SessionAuth = { ...noSessions, authenticate: (token: string) => sessions.get(token) ?? null };
  const app = await buildApp({ config, candidateStore, authService, coachProvider: {} as never, serveStatic: false });
  cleanups.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => candidateStore.close(),
    () => app.close(),
  );
  return { app, databasePath: config.databasePath, candidateStore, sessions };
}

function call(app: App, method: Method, url: string, token?: string, payload?: unknown, key = randomUUID()) {
  return app.inject({
    method,
    url,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      origin: 'http://localhost:3000',
      'idempotency-key': key,
    },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

async function workplace(app: App, token: string) {
  const created = await call(app, 'POST', `${DIARY}/workplaces`, token, {
    company: 'Вектор Банк',
    title: 'Руководитель разработки',
    startDate: '2026-12-01',
  });
  expect(created.statusCode, created.body).toBe(201);
  return created.json().data.id as string;
}

const at = (id: string, tail: string) => `${DIARY}/workplaces/${id}/${tail}`;
const NEW_ROUTES: ReadonlyArray<[Method, string, unknown?]> = [
  ['GET', at(SOME_ID, 'day-30')],
  ['PUT', at(SOME_ID, 'day-30/sent'), { sentOn: '2026-12-30' }],
  ['DELETE', at(SOME_ID, 'day-30/sent')],
  ['GET', at(SOME_ID, 'results-90')],
];

function goal(store: SqliteCandidateStore, candidate: string, title: string, values: number[], target = 7) {
  const created = store.careerDiaryRepo.createGoal(candidate, {
    title, type: 'team', horizon: 'quarter', startDate: '2026-11-01', dueDate: '2027-02-28',
    unit: 'дней', baselineValue: 14, targetValue: target,
  });
  values.forEach((value, index) => {
    store.careerDiaryRepo.recordMeasurement(candidate, created.id, { value, measuredAt: `2026-11-${String(10 + index).padStart(2, '0')}` });
  });
  return created.id;
}

describe('B687: без флага B640', () => {
  it('новые адреса отвечают как несуществующие и таблицу не создают', { timeout: SLOW }, async () => {
    const { app, databasePath } = await setup();
    for (const [method, url, payload] of NEW_ROUTES) {
      for (const token of [plain, undefined]) {
        const response = await call(app, method, url, token, payload);
        expect(response.statusCode, `${method} ${url}`).toBe(404);
      }
    }
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE name = 'career_diary_checkpoints'").all();
    database.close();
    expect(tables).toEqual([]);
  });
});

describe('B687: проверка на 30-й день', () => {
  it('свод из целей и карты людей, отметка «отправлено» ставится и снимается', { timeout: SLOW }, async () => {
    const { app, candidateStore, sessions } = await setup();
    const id = await workplace(app, flagged);
    goal(candidateStore, sessions.get(flagged)!.candidate!.id, 'Срок релиза', [14, 7]);
    const person = await call(app, 'POST', at(id, 'people'), flagged, { name: '', role: '', group: 'Команда', cadence: 'biweekly', headcount: 8, lastMetOn: null });
    expect(person.statusCode, person.body).toBe(201);

    const check = await call(app, 'GET', at(id, 'day-30'), flagged);
    expect(check.statusCode, check.body).toBe(200);
    const data = check.json().data;
    expect(data.dueOn).toBe('2026-12-30');
    expect(data.facts).toEqual([
      { area: 'team', label: 'Команда', value: 'Встречи с 0 из 8 человек' },
      { area: 'result', label: 'Результат', value: 'Срок релиза: 14 → 7 дней' },
    ]);
    expect(data.signal).toEqual({ area: 'team', text: 'Без встречи — 8 человек' });
    expect(data.sentOn).toBeNull();

    const sent = await call(app, 'PUT', at(id, 'day-30/sent'), flagged, { sentOn: '2026-12-30' });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json().data.sentOn).toBe('2026-12-30');
    expect((await call(app, 'GET', at(id, 'day-30'), flagged)).json().data.sentOn).toBe('2026-12-30');
    const undone = await call(app, 'DELETE', at(id, 'day-30/sent'), flagged);
    expect(undone.json().data.sentOn).toBeNull();
  });

  it('неверная дата — 400, чужое место работы — 404', { timeout: SLOW }, async () => {
    const { app } = await setup();
    const id = await workplace(app, flagged);
    expect((await call(app, 'PUT', at(id, 'day-30/sent'), flagged, { sentOn: 'вчера' })).statusCode).toBe(400);
    expect((await call(app, 'PUT', at(id, 'day-30/sent'), flagged, { sentOn: '2026-12-30', extra: 1 })).statusCode).toBe(400);
    expect((await call(app, 'GET', at(id, 'day-30'), other)).statusCode).toBe(404);
    expect((await call(app, 'PUT', at(id, 'day-30/sent'), other, { sentOn: '2026-12-30' })).statusCode).toBe(404);
    expect((await call(app, 'GET', at('не-номер', 'results-90'), flagged)).statusCode).toBe(400);
  });
});

describe('B687: итоги 90 дней', () => {
  it('архивные цели не входят, текст для резюме без цифр работодателя', { timeout: SLOW }, async () => {
    const { app, candidateStore, sessions, databasePath } = await setup();
    const candidate = sessions.get(flagged)!.candidate!.id;
    const id = await workplace(app, flagged);
    goal(candidateStore, candidate, 'Выручка 120 млн ₽', [14, 5]);
    // Статус — как у карточки: замер не сдвинулся с 14 — отстаёт (B662).
    goal(candidateStore, candidate, 'Инциденты', [14, 14]);
    const old = goal(candidateStore, candidate, 'Старая цель', [14, 3]);
    const details = new SqliteDiaryDetailsRepository({ databasePath, encryptionKey: baseConfig.dataEncryptionKey });
    details.saveGoalDetail(candidate, old, { setBy: 'self', agreedOn: null, weight: null, archive: { archivedAt: '2026-12-20T10:00:00.000Z', reason: 'Отменена' }, quarterTargets: null, transfer: null });
    details.close();

    const response = await call(app, 'GET', at(id, 'results-90'), flagged);
    expect(response.statusCode, response.body).toBe(200);
    const data = response.json().data;
    expect(data.periodTo).toBe('2027-02-28');
    expect(data.items.map((item: { title: string; status: string }) => [item.title, item.status]).sort()).toEqual([
      ['Выручка 120 млн ₽', 'done'],
      ['Инциденты', 'behind'],
    ]);
    expect(data.resumeText).toBe('Руководитель разработки: за первые 90 дней — выручка.');
    expect(data.talkText).toContain('1 из 2 целей достигнуто, 1 в работе');
  });
});
