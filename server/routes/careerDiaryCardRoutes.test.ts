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
const ORIGIN = 'http://localhost:3000';
const DIARY = '/api/v1/candidate/career-diary';
const flagged = 'token-flagged';
const other = 'token-other';
const plain = 'token-plain';
const SOME_ID = '00000000-0000-4000-8000-000000000001';

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-diary-cards-'));
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
  return { app, candidateStore, sessions, databasePath: config.databasePath };
}

function call(app: App, method: Method, url: string, token?: string, payload?: unknown, key = randomUUID()) {
  return app.inject({
    method,
    url,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      origin: ORIGIN,
      'idempotency-key': key,
    },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

const CARD = {
  title: 'Выпускать релиз за неделю',
  horizon: 'quarter',
  startDate: '2026-12-01',
  dueDate: '2027-01-29',
  setBy: 'manager',
  agreedOn: '2026-12-12',
  weight: 40,
  indicators: [
    { title: 'Срок релиза, дней', unit: 'дней', baselineValue: 14, targetValue: 7 },
    { title: 'Недель подряд с релизом', unit: 'недель', baselineValue: 0, targetValue: 4 },
    { title: 'Закрытые замечания ИБ', unit: 'шт.', baselineValue: null, targetValue: 'все' },
  ],
};

async function legacyGoal(app: App, token: string, title: string) {
  const response = await call(app, 'POST', `${DIARY}/goals`, token, {
    title,
    type: 'team',
    horizon: 'year',
    startDate: '2026-10-01',
    dueDate: '2027-09-30',
    unit: 'человек',
    baselineValue: 0,
    targetValue: 9,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().data as { id: string };
}

function task(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `Задача ${id}`,
    description: '',
    stage: 'prep',
    category: 'alignment',
    dueDate: '2026-12-01',
    completed: false,
    source: 'template',
    ...over,
  };
}

async function workplaceWithPlan(app: App, token: string, tasks: unknown[] | null) {
  const created = await call(app, 'POST', `${DIARY}/workplaces`, token, {
    company: 'Вектор Банк',
    title: 'Руководитель разработки',
    startDate: '2026-12-01',
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().data.id as string;
  if (tasks) {
    const planning = {
      adaptationPlan: {
        id: randomUUID(),
        workplaceId: id,
        startDate: '2026-12-01',
        createdAt: '2026-11-14T10:00:00.000Z',
        status: 'active',
        closedAt: null,
        tasks,
      },
    };
    const saved = await call(app, 'PATCH', `${DIARY}/workplaces/${id}`, token, { planning });
    expect(saved.statusCode, saved.body).toBe(200);
  }
  return id;
}

const NEW_ROUTES: ReadonlyArray<[Method, string, unknown?]> = [
  ['GET', `${DIARY}/goal-cards`],
  ['POST', `${DIARY}/goal-cards`, CARD],
  ['PATCH', `${DIARY}/goal-cards/${SOME_ID}`, { weight: 10 }],
  ['PUT', `${DIARY}/goal-cards/${SOME_ID}/archive`, { reason: 'Отменена' }],
  ['DELETE', `${DIARY}/goal-cards/${SOME_ID}/archive`],
  ['GET', `${DIARY}/workplaces/${SOME_ID}/adaptation`],
  ['PATCH', `${DIARY}/workplaces/${SOME_ID}/adaptation`, { relocated: false }],
];

describe('B684: без флага B640', () => {
  it('новые адреса отвечают как несуществующие и базу не трогают', async () => {
    const { app, databasePath } = await setup();
    const absent = await call(app, 'GET', '/api/v1/candidate/no-such-route', plain);
    for (const [method, url, payload] of NEW_ROUTES) {
      for (const token of [plain, undefined]) {
        const response = await call(app, method, url, token, payload);
        expect(response.statusCode, `${method} ${url}`).toBe(404);
        expect(response.json().error.code).toBe(absent.json().error.code);
      }
    }
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'career_diary_%_details'")
      .all();
    database.close();
    expect(tables).toEqual([]);
  });

  it('прежние цели и план отвечают прежней формой', async () => {
    const { app } = await setup();
    const goal = await legacyGoal(app, plain, 'Встречи один на один');
    const read = await call(app, 'GET', `${DIARY}/goals/${goal.id}`, plain);
    expect(Object.keys(read.json().data).sort()).toEqual(
      [
        'baselineValue',
        'createdAt',
        'dueDate',
        'horizon',
        'id',
        'isPrimary',
        'latestMeasurement',
        'parentGoalId',
        'risk',
        'startDate',
        'targetValue',
        'title',
        'type',
        'unit',
        'updatedAt',
        'valueSource',
      ].sort(),
    );
    const workplaceId = await workplaceWithPlan(app, plain, [task('a')]);
    const workplace = (await call(app, 'GET', `${DIARY}/workplaces/${workplaceId}`, plain)).json().data;
    expect(Object.keys(workplace.planning.adaptationPlan.tasks[0]).sort()).toEqual(
      ['category', 'completed', 'description', 'dueDate', 'id', 'source', 'stage', 'title'].sort(),
    );
  });
});

describe('B684: цель с показателями под флагом', () => {
  it('создаётся одной формой и читается одним ответом', async () => {
    const { app, databasePath } = await setup();
    const created = await call(app, 'POST', `${DIARY}/goal-cards`, flagged, CARD);
    expect(created.statusCode, created.body).toBe(201);
    const card = created.json().data;
    expect(card).toMatchObject({
      title: CARD.title,
      horizon: 'quarter',
      type: 'operational',
      dueDate: CARD.dueDate,
      details: { setBy: 'manager', agreedOn: '2026-12-12', weight: 40, archive: null },
    });
    expect(card.indicators.map((item: { title: string }) => item.title).sort()).toEqual(
      CARD.indicators.map((item) => item.title).sort(),
    );
    expect(card.indicators[0]).toMatchObject({ parentGoalId: card.id, latestMeasurement: null });
    expect(card.indicators[0].risk.status).toBe('unknown');

    const list = (await call(app, 'GET', `${DIARY}/goal-cards`, flagged)).json().data;
    expect(list.items).toHaveLength(1);
    expect(list.items[0].indicators).toHaveLength(3);
    expect(list.archived).toEqual([]);

    const database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare('SELECT * FROM career_diary_goal_details').get() as Record<string, string>;
    database.close();
    expect(JSON.stringify(row)).not.toContain('manager');
  });

  it('замер показателя виден в карточке цели', async () => {
    const { app } = await setup();
    const card = (await call(app, 'POST', `${DIARY}/goal-cards`, flagged, CARD)).json().data;
    const release = card.indicators.find((item: { unit: string }) => item.unit === 'дней');
    const measured = await call(app, 'POST', `${DIARY}/goals/${release.id}/measurements`, flagged, {
      value: 5,
      measuredAt: '2027-01-03',
    });
    expect(measured.statusCode, measured.body).toBe(201);
    const again = (await call(app, 'GET', `${DIARY}/goal-cards`, flagged)).json().data.items[0];
    const indicator = again.indicators.find((item: { id: string }) => item.id === release.id);
    expect(indicator.latestMeasurement).toMatchObject({ value: 5, measuredAt: '2027-01-03' });
    // Риск считает прежнее правило дневника: здесь важно, что он пересчитан по замеру.
    expect(indicator.risk.rule).not.toBe('measurement_required');
  });

  it('повтор с тем же ключом не плодит цели, с другими данными — отказ', async () => {
    const { app } = await setup();
    const key = randomUUID();
    const first = await call(app, 'POST', `${DIARY}/goal-cards`, flagged, CARD, key);
    const second = await call(app, 'POST', `${DIARY}/goal-cards`, flagged, CARD, key);
    expect(second.statusCode).toBe(201);
    expect(second.json().data.id).toBe(first.json().data.id);
    const list = (await call(app, 'GET', `${DIARY}/goal-cards`, flagged)).json().data;
    expect(list.items).toHaveLength(1);
    expect(list.items[0].indicators).toHaveLength(3);
    const changed = await call(app, 'POST', `${DIARY}/goal-cards`, flagged, { ...CARD, title: 'Другая' }, key);
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.code).toBe('idempotency_key_reused');
  });

  it('старые цели читаются без потерь: без показателей и с деталями по умолчанию', async () => {
    const { app } = await setup();
    const goal = await legacyGoal(app, flagged, 'Встречи один на один');
    const list = (await call(app, 'GET', `${DIARY}/goal-cards`, flagged)).json().data;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: goal.id,
      title: 'Встречи один на один',
      type: 'team',
      unit: 'человек',
      targetValue: 9,
      indicators: [],
      details: { setBy: 'self', agreedOn: null, weight: null, archive: null },
    });
  });

  it('детали правятся, цель уходит в архив с причиной и возвращается', async () => {
    const { app } = await setup();
    const goal = await legacyGoal(app, flagged, 'Перевести сборку на общий конвейер');
    const patched = await call(app, 'PATCH', `${DIARY}/goal-cards/${goal.id}`, flagged, {
      setBy: 'manager',
      weight: 20,
    });
    expect(patched.json().data.details).toMatchObject({ setBy: 'manager', weight: 20, agreedOn: null });
    const reason = 'Отменена директором: банк меняет платформу сборки';
    const archived = await call(app, 'PUT', `${DIARY}/goal-cards/${goal.id}/archive`, flagged, { reason });
    expect(archived.json().data.details.archive).toMatchObject({ reason });
    const list = (await call(app, 'GET', `${DIARY}/goal-cards`, flagged)).json().data;
    expect(list.items).toEqual([]);
    expect(list.archived.map((card: { id: string }) => card.id)).toEqual([goal.id]);
    expect(list.archived[0].details).toMatchObject({ setBy: 'manager', weight: 20 });
    // Прежний список целей архивом не затронут.
    expect((await call(app, 'GET', `${DIARY}/goals`, flagged)).json().data.items).toHaveLength(1);
    const restored = await call(app, 'DELETE', `${DIARY}/goal-cards/${goal.id}/archive`, flagged);
    expect(restored.json().data.details.archive).toBeNull();
  });

  it('детали удалённой цели не остаются в базе', async () => {
    const { app, databasePath } = await setup();
    const goal = await legacyGoal(app, flagged, 'Временная цель');
    await call(app, 'PUT', `${DIARY}/goal-cards/${goal.id}/archive`, flagged, { reason: 'Отменена' });
    expect((await call(app, 'DELETE', `${DIARY}/goals/${goal.id}`, flagged)).statusCode).toBeLessThan(300);
    const list = (await call(app, 'GET', `${DIARY}/goal-cards`, flagged)).json().data;
    expect(list).toEqual({ items: [], archived: [] });
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const left = database.prepare('SELECT COUNT(*) AS total FROM career_diary_goal_details').get();
    database.close();
    expect(left).toEqual({ total: 0 });
  });

  it('отклоняет неверные данные, чужую цель и показатель вместо цели', async () => {
    const { app } = await setup();
    const bad: unknown[] = [
      { ...CARD, indicators: [] },
      { ...CARD, indicators: Array.from({ length: 4 }, () => CARD.indicators[0]) },
      { ...CARD, setBy: 'director' },
      { ...CARD, weight: 101 },
      { ...CARD, dueDate: '2026-11-01' },
      { ...CARD, agreedOn: '2026-02-31' },
      { ...CARD, extra: true },
    ];
    for (const payload of bad) {
      const response = await call(app, 'POST', `${DIARY}/goal-cards`, flagged, payload);
      expect(response.statusCode, JSON.stringify(payload).slice(0, 80)).toBe(400);
    }
    const foreign = await legacyGoal(app, other, 'Чужая цель');
    expect((await call(app, 'PATCH', `${DIARY}/goal-cards/${foreign.id}`, flagged, { weight: 5 })).statusCode).toBe(404);
    expect((await call(app, 'PUT', `${DIARY}/goal-cards/${foreign.id}/archive`, flagged, { reason: 'x' })).statusCode).toBe(404);
    const card = (await call(app, 'POST', `${DIARY}/goal-cards`, flagged, CARD)).json().data;
    const indicatorId = card.indicators[0].id;
    expect((await call(app, 'PATCH', `${DIARY}/goal-cards/${indicatorId}`, flagged, { weight: 5 })).statusCode).toBe(404);
    expect((await call(app, 'GET', `${DIARY}/goal-cards`, other)).json().data.items.map((c: { title: string }) => c.title)).toEqual(['Чужая цель']);
  });
});

describe('B684: план адаптации под флагом', () => {
  it('отдаёт шесть шагов со сводкой и этапы; старый план читается без потерь', async () => {
    const { app } = await setup();
    const workplaceId = await workplaceWithPlan(app, flagged, [
      task('a'),
      task('b', { completed: true }),
      task('c', { stage: 'days_1_30', category: 'people' }),
      task('d', { stage: 'days_31_60', category: 'delivery' }),
    ]);
    const view = (await call(app, 'GET', `${DIARY}/workplaces/${workplaceId}/adaptation`, flagged)).json().data;
    expect(view).toMatchObject({ workplaceId, hasPlan: true, startDate: '2026-12-01', relocated: null });
    expect(view.steps.map((step: { id: string }) => step.id)).toEqual([
      'before_start',
      'first_two_weeks',
      'first_meeting',
      'people_map',
      'day_30_check',
      'settling',
    ]);
    expect(view.steps[0]).toMatchObject({ tasksTotal: 2, tasksDone: 1, status: 'active' });
    expect(view.steps[1]).toMatchObject({ tasksTotal: 1, tasksDone: 0 });
    expect(view.stages.map((stage: { tasksTotal: number }) => stage.tasksTotal)).toEqual([2, 1, 1, 0]);
    const titles = view.stages.flatMap((stage: { tasks: { title: string }[] }) => stage.tasks.map((t) => t.title));
    expect(titles.sort()).toEqual(['Задача a', 'Задача b', 'Задача c', 'Задача d']);
  });

  it('шаг, группа, цель задачи, цели этапов и поля кандидата сохраняются', async () => {
    const { app, databasePath } = await setup();
    const goal = await legacyGoal(app, flagged, 'Выпускать релиз за неделю');
    const workplaceId = await workplaceWithPlan(app, flagged, [task('a'), task('b')]);
    const firstMeeting = {
      heldOn: '2026-12-02',
      expectations: 'Релизы предсказуемые, команда не теряет людей',
      successByDay90: 'Релиз за неделю, 2 вакансии закрыты',
      measures: 'Срок релиза в днях',
      cadence: 'Раз в 2 недели по средам',
      needsApproval: 'Выкладки в периоды отчётности',
      ownDecisions: 'Найм в рамках бюджета',
      manager: 'Ирина Лаврова, директор по технологиям',
    };
    const saved = await call(app, 'PATCH', `${DIARY}/workplaces/${workplaceId}/adaptation`, flagged, {
      tasks: {
        a: { step: 'settling', group: 'Документы', goalId: null },
        b: { step: 'before_start', group: 'Уточнить у HR', goalId: goal.id },
      },
      stages: { days_31_60: { title: 'Первый заметный результат', goalId: goal.id } },
      probation: { endsOn: '2027-03-01', reviewer: 'Ирина Лаврова' },
      firstMeeting,
      relocated: false,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const view = saved.json().data;
    expect(view.steps[5].groups).toEqual([
      { name: 'Документы', tasks: [expect.objectContaining({ id: 'a', step: 'settling' })] },
    ]);
    expect(view.steps[0].groups[0]).toMatchObject({ name: 'Уточнить у HR' });
    expect(view.steps[0].groups[0].tasks[0]).toMatchObject({ id: 'b', goalId: goal.id });
    expect(view.stages[2]).toMatchObject({ title: 'Первый заметный результат', goalId: goal.id });
    expect(view).toMatchObject({
      probation: { endsOn: '2027-03-01', reviewer: 'Ирина Лаврова' },
      firstMeeting,
      relocated: false,
    });
    // Частичная правка не стирает остальное; прежний план места работы не изменился.
    const partial = await call(app, 'PATCH', `${DIARY}/workplaces/${workplaceId}/adaptation`, flagged, { relocated: true });
    expect(partial.json().data).toMatchObject({ relocated: true, firstMeeting });
    expect(partial.json().data.steps[5].tasksTotal).toBe(1);
    // Одно поле задачи правится отдельно; `null` убирает детали — задача возвращается в шаг по умолчанию.
    const url = `${DIARY}/workplaces/${workplaceId}/adaptation`;
    const regrouped = (await call(app, 'PATCH', url, flagged, { tasks: { a: { group: 'Банк' } } })).json().data;
    expect(regrouped.steps[5].groups).toEqual([
      { name: 'Банк', tasks: [expect.objectContaining({ id: 'a', step: 'settling' })] },
    ]);
    const cleared = (await call(app, 'PATCH', url, flagged, { tasks: { a: null }, firstMeeting: null })).json().data;
    expect(cleared.steps[5].tasksTotal).toBe(0);
    expect(cleared.steps[0].tasksTotal).toBe(2);
    expect(cleared.firstMeeting).toBeNull();
    const workplace = (await call(app, 'GET', `${DIARY}/workplaces/${workplaceId}`, flagged)).json().data;
    expect(Object.keys(workplace.planning.adaptationPlan.tasks[0])).not.toContain('step');

    const database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare('SELECT * FROM career_diary_adaptation_details').get() as Record<string, string>;
    database.close();
    expect(JSON.stringify(row)).not.toContain('Лаврова');
  });

  it('место работы без плана отдаёт пустые шаги; чужое и неверное — отказ', async () => {
    const { app } = await setup();
    const empty = await workplaceWithPlan(app, flagged, null);
    const view = (await call(app, 'GET', `${DIARY}/workplaces/${empty}/adaptation`, flagged)).json().data;
    expect(view.hasPlan).toBe(false);
    expect(view.steps).toHaveLength(6);
    const foreignGoal = await legacyGoal(app, other, 'Чужая цель');
    const workplaceId = await workplaceWithPlan(app, flagged, [task('a')]);
    const url = `${DIARY}/workplaces/${workplaceId}/adaptation`;
    const bad: unknown[] = [
      {},
      { tasks: { missing: { step: 'settling', group: null, goalId: null } } },
      { tasks: { a: { step: 'unknown', group: null, goalId: null } } },
      { tasks: { a: { step: 'settling', group: null, goalId: foreignGoal.id } } },
      { stages: { days_1_30: { title: null, goalId: foreignGoal.id } } },
      { probation: { endsOn: '2027-02-30', reviewer: null } },
      { relocated: 'нет' },
      { extra: 1 },
    ];
    for (const payload of bad) {
      const response = await call(app, 'PATCH', url, flagged, payload);
      expect(response.statusCode, JSON.stringify(payload).slice(0, 80)).toBe(400);
    }
    expect((await call(app, 'GET', url, other)).statusCode).toBe(404);
    expect((await call(app, 'PATCH', url, other, { relocated: true })).statusCode).toBe(404);
    expect((await call(app, 'GET', url, flagged)).json().data.relocated).toBeNull();
  });

  it('детали задач не теряются, пока плана нет', async () => {
    const { app } = await setup();
    const workplaceId = await workplaceWithPlan(app, flagged, [task('a')]);
    const url = `${DIARY}/workplaces/${workplaceId}/adaptation`;
    await call(app, 'PATCH', url, flagged, { tasks: { a: { step: 'settling' } } });
    const removed = await call(app, 'PATCH', `${DIARY}/workplaces/${workplaceId}`, flagged, {
      planning: { adaptationPlan: null },
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect((await call(app, 'PATCH', url, flagged, { relocated: false })).statusCode).toBe(200);
    const planning = {
      adaptationPlan: {
        id: randomUUID(),
        workplaceId,
        startDate: '2026-12-01',
        createdAt: '2026-11-14T10:00:00.000Z',
        status: 'active',
        closedAt: null,
        tasks: [task('a')],
      },
    };
    await call(app, 'PATCH', `${DIARY}/workplaces/${workplaceId}`, flagged, { planning });
    const view = (await call(app, 'GET', url, flagged)).json().data;
    expect(view.steps[5].tasksTotal).toBe(1);
  });

  it('удаление кандидата стирает детали целей и плана', async () => {
    const { app, candidateStore, sessions, databasePath } = await setup();
    await call(app, 'POST', `${DIARY}/goal-cards`, flagged, CARD);
    const workplaceId = await workplaceWithPlan(app, flagged, [task('a')]);
    await call(app, 'PATCH', `${DIARY}/workplaces/${workplaceId}/adaptation`, flagged, { relocated: true });
    candidateStore.deleteCandidate(sessions.get(flagged)!.candidate!.id);
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const count = (table: string) =>
      (database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total;
    expect(count('career_diary_goal_details')).toBe(0);
    expect(count('career_diary_adaptation_details')).toBe(0);
    database.close();
  });
});
