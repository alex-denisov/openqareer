import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import type { GoalTaskModelAnswer, GoalTaskSuggestionInput } from '../domain/goalTaskSuggestion';
import type { GoalTaskSuggester } from '../providers/goalTaskSuggester';

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const ORIGIN = 'http://localhost:3000';
const DIARY = '/api/v1/candidate/career-diary';
const flagged = 'token-flagged';
const other = 'token-other';
const plain = 'token-plain';
const SLOW = 60_000;
const GOAL_DUE = '2029-12-31';
const ANSWER: GoalTaskModelAnswer = { task: 'Описание второй вакансии в повестку', dueDate: null };

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Suggest = (input: GoalTaskSuggestionInput) => Promise<GoalTaskModelAnswer | null>;
const suggesterOf = (answer: GoalTaskModelAnswer | null) => {
  const suggest = vi.fn<Suggest>(async () => answer);
  return { suggest } satisfies GoalTaskSuggester;
};

async function setup(suggester?: GoalTaskSuggester) {
  const directory = mkdtempSync(join(tmpdir(), 'oq-diary-suggestion-'));
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
    ...(suggester ? { goalTaskSuggester: suggester } : {}),
  });
  cleanups.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => candidateStore.close(),
    () => app.close(),
  );
  return {
    app,
    databasePath: config.databasePath,
    store: candidateStore,
    candidate: sessions.get(flagged)!.candidate!.id,
  };
}

function call(
  app: App,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  token?: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      origin: ORIGIN,
      'idempotency-key': randomUUID(),
    },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

const CARD = {
  title: 'Закрыть 2 вакансии в команду',
  horizon: 'quarter',
  startDate: '2026-11-01',
  dueDate: GOAL_DUE,
  setBy: 'manager',
  indicators: [{ title: 'Закрыто вакансий', unit: 'шт', baselineValue: 0, targetValue: 2 }],
};

async function goalWithPlan(app: App, token: string, withWorkplace = true) {
  const goal = await call(app, 'POST', `${DIARY}/goal-cards`, token, CARD);
  expect(goal.statusCode, goal.body).toBe(201);
  const goalId = goal.json().data.id as string;
  if (!withWorkplace) return { goalId, workplaceId: null };
  const created = await call(app, 'POST', `${DIARY}/workplaces`, token, {
    company: 'Вектор Банк',
    title: 'Руководитель разработки',
    startDate: '2026-11-01',
  });
  expect(created.statusCode, created.body).toBe(201);
  const workplaceId = created.json().data.id as string;
  const taskId = randomUUID();
  const planning = {
    adaptationPlan: {
      id: randomUUID(),
      workplaceId,
      startDate: '2026-11-01',
      createdAt: '2026-11-14T10:00:00.000Z',
      status: 'active',
      closedAt: null,
      tasks: [
        {
          id: taskId,
          title: 'Созвон с отделом найма о воронке',
          description: '',
          stage: 'days_1_30',
          category: 'delivery',
          dueDate: '2029-01-10',
          completed: false,
          source: 'candidate',
        },
      ],
    },
  };
  const saved = await call(app, 'PATCH', `${DIARY}/workplaces/${workplaceId}`, token, { planning });
  expect(saved.statusCode, saved.body).toBe(200);
  const bound = await call(app, 'PATCH', `${DIARY}/workplaces/${workplaceId}/adaptation`, token, {
    tasks: { [taskId]: { goalId } },
  });
  expect(bound.statusCode, bound.body).toBe(200);
  return { goalId, workplaceId };
}

const url = (goalId: string, tail = '') => `${DIARY}/goal-cards/${goalId}/task-suggestion${tail}`;

describe('B743 · 2: без флага B640', () => {
  it(
    'адреса отвечают как несуществующие, модель не зовётся, таблица не создаётся',
    async () => {
      const suggester = suggesterOf(ANSWER);
      const { app, databasePath } = await setup(suggester);
      const goal = randomUUID();
      const sub = randomUUID();
      const absent = await call(app, 'GET', '/api/v1/candidate/no-such-route', plain);
      const routes: Array<['GET' | 'POST', string]> = [
        ['GET', url(goal)],
        ['POST', url(goal, `/${sub}/skip`)],
        ['POST', url(goal, `/${sub}/accept`)],
      ];
      for (const [method, path] of routes) {
        for (const token of [plain, undefined]) {
          const response = await call(app, method, path, token);
          expect(response.statusCode, `${method} ${path}`).toBe(404);
          expect(response.json().error.code).toBe(absent.json().error.code);
        }
      }
      expect(suggester.suggest).not.toHaveBeenCalled();
      const database = new DatabaseSync(databasePath, { readOnly: true });
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE name = 'career_diary_task_suggestions'")
        .all();
      database.close();
      expect(tables).toEqual([]);
    },
    SLOW,
  );
});

describe('B743 · 2: подсказка задачи под флагом', () => {
  it(
    'первый запрос зовёт модель, срок по умолчанию в периоде цели, повтор берёт из хранилища',
    async () => {
      const suggester = suggesterOf(ANSWER);
      const { app, databasePath } = await setup(suggester);
      const { goalId } = await goalWithPlan(app, flagged);
      const first = await call(app, 'GET', url(goalId), flagged);
      expect(first.statusCode, first.body).toBe(200);
      const data = first.json().data as { id: string; text: string; dueDate: string };
      expect(data.text).toBe('Описание второй вакансии в повестку');
      expect(data.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(data.dueDate <= GOAL_DUE).toBe(true);
      const input = suggester.suggest.mock.calls[0]![0];
      expect(input.context.goal.title).toBe('Закрыть 2 вакансии в команду');
      expect(input.context.tasks.map((task) => task.title)).toEqual([
        'Созвон с отделом найма о воронке',
      ]);

      const second = await call(app, 'GET', url(goalId), flagged);
      expect(second.json().data).toEqual(data);
      expect(suggester.suggest).toHaveBeenCalledTimes(1);

      const database = new DatabaseSync(databasePath, { readOnly: true });
      const raw = JSON.stringify(
        database.prepare('SELECT * FROM career_diary_task_suggestions').all(),
      );
      database.close();
      expect(raw).not.toContain('второй вакансии');
    },
    SLOW,
  );

  it(
    '«Пропустить» прячет подсказку, и её не повторяют при изменении данных цели',
    async () => {
      const suggester = suggesterOf(ANSWER);
      const { app, store, candidate } = await setup(suggester);
      const { goalId } = await goalWithPlan(app, flagged);
      const shown = (await call(app, 'GET', url(goalId), flagged)).json().data as { id: string };
      const skipped = await call(app, 'POST', url(goalId, `/${shown.id}/skip`), flagged);
      expect(skipped.statusCode).toBe(204);
      expect((await call(app, 'GET', url(goalId), flagged)).json().data).toBeNull();
      expect(suggester.suggest).toHaveBeenCalledTimes(1);

      store.careerDiaryRepo.recordMeasurement(candidate, goalId, {
        measuredAt: '2026-11-20',
        value: 1,
        note: 'Один финал',
      });
      const regenerated = await call(app, 'GET', url(goalId), flagged);
      expect(regenerated.json().data).toBeNull();
      expect(suggester.suggest).toHaveBeenCalledTimes(2);
      expect(suggester.suggest.mock.calls[1]![0].skipped).toEqual([
        'Описание второй вакансии в повестку',
      ]);
      expect(suggester.suggest.mock.calls[1]![0].context.measurements).toEqual([
        { date: '2026-11-20', value: 1, comment: 'Один финал' },
      ]);
    },
    SLOW,
  );

  it(
    '«Добавить» закрывает подсказку: данные те же — подсказки нет, модель не зовётся',
    async () => {
      const suggester = suggesterOf(ANSWER);
      const { app } = await setup(suggester);
      const { goalId } = await goalWithPlan(app, flagged);
      const shown = (await call(app, 'GET', url(goalId), flagged)).json().data as { id: string };
      expect(
        (await call(app, 'POST', url(goalId, `/${shown.id}/accept`), flagged)).statusCode,
      ).toBe(204);
      expect(
        (await call(app, 'POST', url(goalId, `/${shown.id}/accept`), flagged)).statusCode,
      ).toBe(204);
      expect((await call(app, 'GET', url(goalId), flagged)).json().data).toBeNull();
      expect(suggester.suggest).toHaveBeenCalledTimes(1);
    },
    SLOW,
  );

  it(
    'модель сломалась — подсказки нет без ошибки, ничего не запомнено; ответ «нет задачи» запоминается',
    async () => {
      const suggester = suggesterOf(null);
      const { app } = await setup(suggester);
      const { goalId } = await goalWithPlan(app, flagged);
      const failed = await call(app, 'GET', url(goalId), flagged);
      expect(failed.statusCode).toBe(200);
      expect(failed.json().data).toBeNull();
      suggester.suggest.mockRejectedValueOnce(new Error('boom'));
      expect((await call(app, 'GET', url(goalId), flagged)).json().data).toBeNull();
      suggester.suggest.mockResolvedValueOnce({ task: null, dueDate: null });
      expect((await call(app, 'GET', url(goalId), flagged)).json().data).toBeNull();
      expect(suggester.suggest).toHaveBeenCalledTimes(3);
      expect((await call(app, 'GET', url(goalId), flagged)).json().data).toBeNull();
      expect(suggester.suggest).toHaveBeenCalledTimes(3);
    },
    SLOW,
  );

  it(
    'дубль задачи цели отбрасывается, срок вне периода цели заменяется сроком по умолчанию',
    async () => {
      const suggester = suggesterOf({ task: 'Созвон с отделом найма о воронке', dueDate: null });
      const { app } = await setup(suggester);
      const { goalId } = await goalWithPlan(app, flagged);
      expect((await call(app, 'GET', url(goalId), flagged)).json().data).toBeNull();

      const late = suggesterOf({ task: 'Подготовить повестку', dueDate: '2031-01-01' });
      const second = await setup(late);
      const { goalId: lateGoal } = await goalWithPlan(second.app, flagged);
      const data = (await call(second.app, 'GET', url(lateGoal), flagged)).json().data as {
        dueDate: string;
      };
      expect(data.dueDate <= GOAL_DUE).toBe(true);
    },
    SLOW,
  );

  it(
    'без основного места работы или без модели подсказки нет, модель не зовётся',
    async () => {
      const suggester = suggesterOf(ANSWER);
      const { app } = await setup(suggester);
      const { goalId } = await goalWithPlan(app, flagged, false);
      const noWorkplace = await call(app, 'GET', url(goalId), flagged);
      expect(noWorkplace.statusCode).toBe(200);
      expect(noWorkplace.json().data).toBeNull();
      expect(suggester.suggest).not.toHaveBeenCalled();

      const bare = await setup();
      const { goalId: bareGoal } = await goalWithPlan(bare.app, flagged);
      const response = await call(bare.app, 'GET', url(bareGoal), flagged);
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toBeNull();
    },
    SLOW,
  );

  it(
    'не больше 20 вызовов модели в сутки на кандидата',
    async () => {
      const suggester = suggesterOf(null);
      const { app } = await setup(suggester);
      const { goalId } = await goalWithPlan(app, flagged);
      for (let index = 0; index < 20; index += 1) await call(app, 'GET', url(goalId), flagged);
      expect(suggester.suggest).toHaveBeenCalledTimes(20);
      suggester.suggest.mockResolvedValue(ANSWER);
      const capped = await call(app, 'GET', url(goalId), flagged);
      expect(capped.statusCode).toBe(200);
      expect(capped.json().data).toBeNull();
      expect(suggester.suggest).toHaveBeenCalledTimes(20);
    },
    SLOW,
  );

  it(
    'чужая цель и чужая подсказка — 404, подсказка не меняется',
    async () => {
      const suggester = suggesterOf(ANSWER);
      const { app } = await setup(suggester);
      const { goalId } = await goalWithPlan(app, flagged);
      const shown = (await call(app, 'GET', url(goalId), flagged)).json().data as { id: string };
      expect((await call(app, 'GET', url(goalId), other)).statusCode).toBe(404);
      expect((await call(app, 'POST', url(goalId, `/${shown.id}/skip`), other)).statusCode).toBe(
        404,
      );
      expect(
        (await call(app, 'POST', url(randomUUID(), `/${shown.id}/skip`), flagged)).statusCode,
      ).toBe(404);
      expect(
        (await call(app, 'POST', url(goalId, `/${randomUUID()}/accept`), flagged)).statusCode,
      ).toBe(404);
      expect((await call(app, 'POST', url(goalId, '/not-an-id/accept'), flagged)).statusCode).toBe(
        404,
      );
      expect((await call(app, 'GET', url('not-an-id'), flagged)).statusCode).toBe(404);
      expect((await call(app, 'GET', url(goalId), flagged)).json().data).toMatchObject({
        id: shown.id,
      });
    },
    SLOW,
  );
});
