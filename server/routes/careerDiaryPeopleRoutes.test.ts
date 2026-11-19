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
  const directory = mkdtempSync(join(tmpdir(), 'oq-diary-people-'));
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

const BOSS = {
  name: 'Ирина Лаврова',
  role: 'директор по технологиям',
  group: 'Руководитель',
  cadence: 'biweekly',
  headcount: 1,
  lastMetOn: '2026-12-09',
};
const TESTS = { name: '', role: 'Руководитель тестовых сред', group: 'Соседние команды', cadence: 'on_demand', headcount: 1, lastMetOn: null };
const REST = { name: '', role: '', group: 'Команда', cadence: 'biweekly', headcount: 8, lastMetOn: null };

const people = (id: string) => `${DIARY}/workplaces/${id}/people`;

async function add(app: App, id: string, person: object) {
  const response = await call(app, 'POST', people(id), flagged, person);
  expect(response.statusCode, response.body).toBe(201);
  return response.json().data as {
    total: number;
    withoutMeeting: number;
    nextMeeting: { personId: string; date: string } | null;
    groups: Array<{ name: string; headcount: number; people: Array<{ id: string; status: string; role: string }> }>;
  };
}

const NEW_ROUTES: ReadonlyArray<[Method, string, unknown?]> = [
  ['GET', people(SOME_ID)],
  ['POST', people(SOME_ID), BOSS],
  ['PATCH', `${people(SOME_ID)}/${SOME_ID}`, { lastMetOn: '2026-12-10' }],
  ['DELETE', `${people(SOME_ID)}/${SOME_ID}`],
  ['PUT', `${people(SOME_ID)}/${SOME_ID}/meeting`, { date: '2027-01-08' }],
  ['DELETE', `${people(SOME_ID)}/${SOME_ID}/meeting`],
];

describe('B685: без флага B640', () => {
  it('новые адреса отвечают как несуществующие и таблицу не создают', { timeout: SLOW }, async () => {
    const { app, databasePath } = await setup();
    for (const [method, url, payload] of NEW_ROUTES) {
      for (const token of [plain, undefined]) {
        const response = await call(app, method, url, token, payload);
        expect(response.statusCode, `${method} ${url}`).toBe(404);
      }
    }
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE name = 'career_diary_people'").all();
    database.close();
    expect(tables).toEqual([]);
  });
});

describe('B685: карта людей', () => {
  it('человек добавлен, встреча назначена и появилась в плане шага «Карта людей»', { timeout: SLOW }, async () => {
    const { app } = await setup();
    const id = await workplace(app, flagged);
    await add(app, id, BOSS);
    const map = await add(app, id, TESTS);
    const tests = map.groups[1]!.people[0]!;
    expect(tests.status).toBe('none');

    const planned = await call(app, 'PUT', `${people(id)}/${tests.id}/meeting`, flagged, { date: '2027-01-08' });
    expect(planned.statusCode, planned.body).toBe(200);
    expect(planned.json().data.nextMeeting).toEqual({ personId: tests.id, date: '2027-01-08' });

    const plan = await call(app, 'GET', `${DIARY}/workplaces/${id}/adaptation`, flagged);
    const step = plan.json().data.steps.find((item: { id: string }) => item.id === 'people_map');
    const tasks = step.groups.flatMap((group: { tasks: unknown[] }) => group.tasks);
    expect(tasks).toEqual([
      expect.objectContaining({ title: 'Встреча: Руководитель тестовых сред', dueDate: '2027-01-08', completed: false }),
    ]);

    const moved = await call(app, 'PUT', `${people(id)}/${tests.id}/meeting`, flagged, { date: '2026-12-20' });
    expect(moved.json().data.nextMeeting.date).toBe('2026-12-20');
    const again = await call(app, 'GET', `${DIARY}/workplaces/${id}/adaptation`, flagged);
    const all = again.json().data.stages.flatMap((stage: { tasks: unknown[] }) => stage.tasks);
    expect(all).toHaveLength(1);

    const cancelled = await call(app, 'DELETE', `${people(id)}/${tests.id}/meeting`, flagged);
    expect(cancelled.json().data.nextMeeting).toBeNull();
  });

  it('сводка считает людей без встречи; отметка о встрече закрывает задачу плана', { timeout: SLOW }, async () => {
    const { app } = await setup();
    const id = await workplace(app, flagged);
    await add(app, id, BOSS);
    await add(app, id, REST);
    const map = await add(app, id, TESTS);
    expect(map.total).toBe(10);
    expect(map.withoutMeeting).toBe(9);
    const tests = map.groups.find((group) => group.name === 'Соседние команды')!.people[0]!;
    await call(app, 'PUT', `${people(id)}/${tests.id}/meeting`, flagged, { date: '2026-12-20' });
    const scheduled = await call(app, 'GET', people(id), flagged);
    expect(scheduled.json().data.withoutMeeting).toBe(8);

    const met = await call(app, 'PATCH', `${people(id)}/${tests.id}`, flagged, { lastMetOn: '2026-12-20' });
    expect(met.statusCode, met.body).toBe(200);
    const view = met.json().data.groups[2].people[0];
    expect(view).toMatchObject({ status: 'met', lastMetOn: '2026-12-20' });
    const plan = await call(app, 'GET', `${DIARY}/workplaces/${id}/adaptation`, flagged);
    const task = plan.json().data.stages.flatMap((stage: { tasks: Array<{ completed: boolean }> }) => stage.tasks)[0];
    expect(task.completed).toBe(true);
  });

  it('удаление человека убирает его назначенную встречу из плана', { timeout: SLOW }, async () => {
    const { app } = await setup();
    const id = await workplace(app, flagged);
    const map = await add(app, id, TESTS);
    const person = map.groups[0]!.people[0]!;
    await call(app, 'PUT', `${people(id)}/${person.id}/meeting`, flagged, { date: '2027-01-08' });
    const removed = await call(app, 'DELETE', `${people(id)}/${person.id}`, flagged);
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().data.total).toBe(0);
    const plan = await call(app, 'GET', `${DIARY}/workplaces/${id}/adaptation`, flagged);
    expect(plan.json().data.stages.flatMap((stage: { tasks: unknown[] }) => stage.tasks)).toEqual([]);
  });

  it('повтор с тем же ключом не создаёт второго человека; плохие данные — 400', { timeout: SLOW }, async () => {
    const { app } = await setup();
    const id = await workplace(app, flagged);
    const key = randomUUID();
    const first = await call(app, 'POST', people(id), flagged, BOSS, key);
    const second = await call(app, 'POST', people(id), flagged, BOSS, key);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.total).toBe(1);
    const empty = await call(app, 'POST', people(id), flagged, { ...REST, headcount: 1 });
    expect(empty.statusCode).toBe(400);
    const boss = second.json().data.groups[0].people[0].id as string;
    const date = await call(app, 'PUT', `${people(id)}/${boss}/meeting`, flagged, { date: '2027-02-30' });
    expect(date.statusCode).toBe(400);
    const missing = await call(app, 'PUT', `${people(id)}/${SOME_ID}/meeting`, flagged, { date: '2027-01-08' });
    expect(missing.statusCode).toBe(404);
  });

  it('имена видит только кандидат: чужое место — 404, в базе имени открытым текстом нет', { timeout: SLOW }, async () => {
    const { app, databasePath } = await setup();
    const id = await workplace(app, flagged);
    await add(app, id, BOSS);
    expect((await call(app, 'GET', people(id), other)).statusCode).toBe(404);
    expect((await call(app, 'POST', people(id), other, TESTS)).statusCode).toBe(404);
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database.prepare('SELECT * FROM career_diary_people').all();
    database.close();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('Лаврова');
  });

  it('ключ обязателен; тот же ключ на другом месте работы — 409, чужая строка не меняется', { timeout: SLOW }, async () => {
    const { app } = await setup();
    const first = await workplace(app, flagged);
    const second = await workplace(app, flagged);
    const noKey = await app.inject({
      method: 'POST',
      url: people(first),
      headers: { authorization: `Bearer ${flagged}`, origin: 'http://localhost:3000' },
      payload: BOSS,
    });
    expect(noKey.statusCode).toBe(400);
    const key = randomUUID();
    await call(app, 'POST', people(first), flagged, BOSS, key);
    const reused = await call(app, 'POST', people(second), flagged, TESTS, key);
    expect(reused.statusCode).toBe(409);
    const kept = await call(app, 'GET', people(first), flagged);
    expect(kept.json().data.groups[0].people[0].role).toBe(BOSS.role);
  });

  it('удаление кандидата удаляет его карту людей', { timeout: SLOW }, async () => {
    const { app, databasePath, candidateStore, sessions } = await setup();
    const id = await workplace(app, flagged);
    await add(app, id, BOSS);
    expect(candidateStore.deleteCandidate(sessions.get(flagged)!.candidate!.id)).toBe(true);
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database.prepare('SELECT COUNT(*) AS n FROM career_diary_people').get() as { n: number };
    database.close();
    expect(rows.n).toBe(0);
  });
});
