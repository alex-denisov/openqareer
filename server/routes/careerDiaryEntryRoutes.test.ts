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

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-diary-entries-'));
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

function call(app: App, method: Method, url: string, token?: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      origin: ORIGIN,
      'idempotency-key': randomUUID(),
    },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

async function write(app: App, token: string, date: string, kind: string, text: string, goalId?: string) {
  const response = await call(app, 'POST', `${DIARY}/entries`, token, { date, kind, text, goalId });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().data as { id: string; weekStart: string };
}

async function goal(app: App, token: string, title: string) {
  const response = await call(app, 'POST', `${DIARY}/goals`, token, {
    title,
    type: 'operational',
    horizon: 'quarter',
    startDate: '2026-10-01',
    dueDate: '2026-12-31',
    unit: 'дней',
    baselineValue: 14,
    targetValue: 7,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().data.id as string;
}

const ENTRY = { date: '2026-11-11', kind: 'result', text: 'Релиз вышел за 5 дней.' };
const SUMMARY = { achievedEntryIds: [], achievedNotes: [], blockers: '', plan: [] };
const NEW_ROUTES: ReadonlyArray<[Method, string, unknown?]> = [
  ['GET', `${DIARY}/entries`],
  ['POST', `${DIARY}/entries`, ENTRY],
  ['PATCH', `${DIARY}/entries/some-id`, { text: 'Другое' }],
  ['DELETE', `${DIARY}/entries/some-id`],
  ['GET', `${DIARY}/weeks/2026-11-09`],
  ['PUT', `${DIARY}/weeks/2026-11-09`, SUMMARY],
];

describe('B683: записи дневника без флага B640', () => {
  it('новые адреса отвечают как несуществующие и ничего не пишут', async () => {
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
    const count = (table: string) =>
      (database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total;
    expect(count('career_diary_entries')).toBe(0);
    expect(count('career_diary_week_summaries')).toBe(0);
    database.close();
  });

  it('прежние маршруты дневника работают как раньше и не знают о записях', async () => {
    const { app } = await setup();
    const overview = await call(app, 'GET', DIARY, plain);
    expect(overview.statusCode).toBe(200);
    expect(Object.keys(overview.json().data).sort()).toEqual(
      ['asOf', 'platformStartedAt', 'primaryWorkplace', 'summary'].sort(),
    );
    const review = await call(app, 'PUT', `${DIARY}/reviews/2026-11-09`, plain, {
      movedForward: 'Релиз',
      blockers: '',
      learning: '',
      risks: '',
      nextWeek: 'План',
    });
    expect(review.statusCode).toBe(200);
    expect(Object.keys(review.json().data).sort()).toEqual(
      ['blockers', 'createdAt', 'learning', 'movedForward', 'nextWeek', 'risks', 'updatedAt', 'weekStart'].sort(),
    );
  });
});

describe('B683: записи дневника под флагом', () => {
  it('запись создаётся, правится и удаляется; текст в базе зашифрован', async () => {
    const { app, databasePath } = await setup();
    const goalId = await goal(app, flagged, 'Выпускать релиз за неделю');
    const created = await call(app, 'POST', `${DIARY}/entries`, flagged, { ...ENTRY, goalId });
    expect(created.statusCode).toBe(201);
    const entry = created.json().data;
    expect(entry).toMatchObject({ ...ENTRY, goalId, weekStart: '2026-11-09' });
    expect(created.headers.location).toBe(`${DIARY}/entries/${entry.id}`);

    const database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare('SELECT * FROM career_diary_entries').get() as Record<string, string>;
    database.close();
    expect(JSON.stringify(row)).not.toContain('Релиз');
    expect(row.kind).toBe('result');

    const patched = await call(app, 'PATCH', `${DIARY}/entries/${entry.id}`, flagged, {
      text: 'Релиз вышел за 4 дня.',
      kind: 'note',
      date: '2026-11-08',
      goalId: null,
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data).toMatchObject({
      id: entry.id,
      text: 'Релиз вышел за 4 дня.',
      kind: 'note',
      date: '2026-11-08',
      weekStart: '2026-11-02',
      goalId: null,
      createdAt: entry.createdAt,
    });

    expect((await call(app, 'DELETE', `${DIARY}/entries/${entry.id}`, flagged)).statusCode).toBe(204);
    expect((await call(app, 'DELETE', `${DIARY}/entries/${entry.id}`, flagged)).statusCode).toBe(404);
    expect((await call(app, 'GET', `${DIARY}/entries`, flagged)).json().data.items).toEqual([]);
  });

  it('повтор создания с тем же ключом не плодит записи, без ключа — отказ', async () => {
    const { app } = await setup();
    const headers = { authorization: `Bearer ${flagged}`, origin: ORIGIN, 'idempotency-key': randomUUID() };
    const first = await app.inject({ method: 'POST', url: `${DIARY}/entries`, headers, payload: ENTRY });
    const second = await app.inject({ method: 'POST', url: `${DIARY}/entries`, headers, payload: ENTRY });
    expect(second.json().data.id).toBe(first.json().data.id);
    expect((await call(app, 'GET', `${DIARY}/entries`, flagged)).json().data.items).toHaveLength(1);
    const reused = await app.inject({
      method: 'POST',
      url: `${DIARY}/entries`,
      headers,
      payload: { ...ENTRY, text: 'Другой текст.' },
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.code).toBe('idempotency_key_reused');
    const keyless = await app.inject({
      method: 'POST',
      url: `${DIARY}/entries`,
      headers: { authorization: `Bearer ${flagged}`, origin: ORIGIN },
      payload: ENTRY,
    });
    expect(keyless.statusCode).toBe(400);
    expect(keyless.json().error.code).toBe('idempotency_key_required');
  });

  it('отклоняет неверные данные и чужую цель', async () => {
    const { app } = await setup();
    const foreignGoal = await goal(app, other, 'Чужая цель');
    const bad: unknown[] = [
      { ...ENTRY, text: '   ' },
      { ...ENTRY, text: 'я'.repeat(2001) },
      { ...ENTRY, kind: 'idea' },
      { ...ENTRY, date: '2026-02-31' },
      { ...ENTRY, date: '2999-01-01' },
      { ...ENTRY, goalId: foreignGoal },
      { ...ENTRY, extra: 1 },
    ];
    for (const payload of bad) {
      const response = await call(app, 'POST', `${DIARY}/entries`, flagged, payload);
      expect(response.statusCode, JSON.stringify(payload).slice(0, 60)).toBe(400);
      expect(response.json().error.code).toBe('invalid_career_diary_input');
    }
    const entry = await write(app, flagged, '2026-11-11', 'note', 'Заметка');
    expect((await call(app, 'PATCH', `${DIARY}/entries/${entry.id}`, flagged, {})).statusCode).toBe(400);
    expect((await call(app, 'GET', `${DIARY}/entries?cursor=broken`, flagged)).statusCode).toBe(400);
    expect((await call(app, 'GET', `${DIARY}/weeks/2026-11-11`, flagged)).statusCode).toBe(400);
  });

  it('чужие записи не видны, не правятся и не удаляются', async () => {
    const { app } = await setup();
    const entry = await write(app, flagged, '2026-11-11', 'note', 'Моя запись');
    expect((await call(app, 'GET', `${DIARY}/entries`, other)).json().data.items).toEqual([]);
    const patch = await call(app, 'PATCH', `${DIARY}/entries/${entry.id}`, other, { text: 'Чужая' });
    expect(patch.statusCode).toBe(404);
    expect((await call(app, 'DELETE', `${DIARY}/entries/${entry.id}`, other)).statusCode).toBe(404);
    const mine = (await call(app, 'GET', `${DIARY}/entries`, flagged)).json().data.items;
    expect(mine).toHaveLength(1);
    expect(mine[0].text).toBe('Моя запись');
  });

  it('запись по cookie с чужой страницы отклоняется', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: `${DIARY}/entries`,
      headers: {
        cookie: `openqareer_session=${flagged}`,
        origin: 'http://malicious.example',
        'idempotency-key': randomUUID(),
      },
      payload: ENTRY,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('origin_not_allowed');
    expect((await call(app, 'GET', `${DIARY}/entries`, flagged)).json().data.items).toEqual([]);
  });

  it('лента: новые сверху, порциями по 20, с неделей у каждой записи и фильтрами', async () => {
    const { app } = await setup();
    const goalId = await goal(app, flagged, 'Выпускать релиз за неделю');
    for (let day = 1; day <= 25; day += 1) {
      const date = `2026-10-${String(day).padStart(2, '0')}`;
      const kind = day % 5 === 0 ? 'problem' : 'result';
      await write(app, flagged, date, kind, `Запись ${day}`, day === 25 ? goalId : undefined);
    }
    const first = (await call(app, 'GET', `${DIARY}/entries`, flagged)).json().data;
    expect(first.items).toHaveLength(20);
    expect(first.items[0]).toMatchObject({ text: 'Запись 25', weekStart: '2026-10-19' });
    expect(first.items.map((item: { date: string }) => item.date)).toEqual(
      [...first.items.map((item: { date: string }) => item.date)].sort().reverse(),
    );
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (
      await call(app, 'GET', `${DIARY}/entries?cursor=${encodeURIComponent(first.nextCursor)}`, flagged)
    ).json().data;
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(second.items.at(-1).text).toBe('Запись 1');

    const problems = (await call(app, 'GET', `${DIARY}/entries?kind=problem`, flagged)).json().data;
    expect(problems.items.map((item: { text: string }) => item.text)).toEqual([
      'Запись 25',
      'Запись 20',
      'Запись 15',
      'Запись 10',
      'Запись 5',
    ]);
    const byGoal = (await call(app, 'GET', `${DIARY}/entries?goalId=${goalId}`, flagged)).json().data;
    expect(byGoal.items.map((item: { text: string }) => item.text)).toEqual(['Запись 25']);
  });
});

describe('B683: итог недели под флагом', () => {
  it('черновик собирает записи недели: что получилось и что мешает', async () => {
    const { app } = await setup();
    const result = await write(app, flagged, '2026-11-11', 'result', 'Релиз вышел за 5 дней.');
    const meeting = await write(app, flagged, '2026-11-10', 'meeting', 'Встреча с директором.');
    await write(app, flagged, '2026-11-12', 'problem', 'Ждали тестовую среду 4 дня.');
    await write(app, flagged, '2026-11-13', 'note', 'Заметка.');
    await write(app, flagged, '2026-11-16', 'result', 'Уже следующая неделя.');
    const draft = (await call(app, 'GET', `${DIARY}/weeks/2026-11-09`, flagged)).json().data;
    expect(draft.weekStart).toBe('2026-11-09');
    expect(draft.entries).toHaveLength(4);
    expect(draft.achievedEntryIds).toEqual([result.id, meeting.id]);
    expect(draft.blockers).toBe('Ждали тестовую среду 4 дня.');
    expect(draft.saved).toBeNull();
  });

  it('итог сохраняется, перечитывается и попадает в ленту своей недели', async () => {
    const { app } = await setup();
    const goalId = await goal(app, flagged, 'Выпускать релиз за неделю');
    const result = await write(app, flagged, '2026-11-11', 'result', 'Релиз вышел за 5 дней.');
    const body = {
      achievedEntryIds: [result.id],
      achievedNotes: ['Договорилась о бюджете'],
      blockers: 'Тестовая среда общая с соседней командой.',
      plan: [{ text: 'Разобрать, где ждёт релиз', goalId, done: false }],
    };
    const saved = await call(app, 'PUT', `${DIARY}/weeks/2026-11-09`, flagged, body);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({ ...body, weekStart: '2026-11-09' });
    const again = await call(app, 'PUT', `${DIARY}/weeks/2026-11-09`, flagged, { ...body, blockers: '' });
    expect(again.json().data.createdAt).toBe(saved.json().data.createdAt);
    const draft = (await call(app, 'GET', `${DIARY}/weeks/2026-11-09`, flagged)).json().data;
    expect(draft.saved).toMatchObject({ achievedEntryIds: [result.id], blockers: '' });
    const feed = (await call(app, 'GET', `${DIARY}/entries`, flagged)).json().data;
    expect(feed.summaries).toHaveLength(1);
    expect(feed.summaries[0]).toMatchObject({ weekStart: '2026-11-09', achievedNotes: body.achievedNotes });
    expect((await call(app, 'GET', `${DIARY}/weeks/2026-11-09`, other)).json().data.saved).toBeNull();
  });

  it('в итог нельзя положить запись другой недели, чужую запись и чужую цель', async () => {
    const { app } = await setup();
    const nextWeek = await write(app, flagged, '2026-11-16', 'result', 'Другая неделя.');
    const foreign = await write(app, other, '2026-11-11', 'result', 'Чужая запись.');
    const foreignGoal = await goal(app, other, 'Чужая цель');
    const attempts = [
      { ...SUMMARY, achievedEntryIds: [nextWeek.id] },
      { ...SUMMARY, achievedEntryIds: [foreign.id] },
      { ...SUMMARY, plan: [{ text: 'Шаг', goalId: foreignGoal, done: false }] },
      { ...SUMMARY, plan: Array.from({ length: 21 }, () => ({ text: 'Шаг', goalId: null })) },
      { ...SUMMARY, blockers: 'я'.repeat(4001) },
    ];
    for (const payload of attempts) {
      const response = await call(app, 'PUT', `${DIARY}/weeks/2026-11-09`, flagged, payload);
      expect(response.statusCode).toBe(400);
    }
    expect((await call(app, 'GET', `${DIARY}/weeks/2026-11-09`, flagged)).json().data.saved).toBeNull();
  });

  it('план недели: невыполненное обещание переносится, цели предлагаются по правилам', async () => {
    const { app } = await setup();
    const releaseGoal = await goal(app, flagged, 'Выпускать релиз за неделю');
    const hiringGoal = await goal(app, flagged, 'Закрыть 2 вакансии');
    await call(app, 'PUT', `${DIARY}/weeks/2026-11-02`, flagged, {
      ...SUMMARY,
      plan: [
        { text: 'Договориться о тестовой среде', goalId: releaseGoal, done: false },
        { text: 'Написать вакансию', goalId: null, done: true },
      ],
    });
    const draft = (await call(app, 'GET', `${DIARY}/weeks/2026-11-09`, flagged)).json().data;
    expect(draft.plan[0]).toEqual({
      text: 'Договориться о тестовой среде',
      goalId: releaseGoal,
      source: 'carried',
    });
    expect(draft.plan.map((item: { goalId: string }) => item.goalId)).toEqual([releaseGoal, hiringGoal]);
    expect(draft.plan[1].source).toMatch(/^goal/u);
  });

  it('обещание переносится и через пропущенную неделю, но не из давнего итога', async () => {
    const { app } = await setup();
    const promise = { text: 'Договориться о тестовой среде', goalId: null, done: false };
    await call(app, 'PUT', `${DIARY}/weeks/2026-10-26`, flagged, { ...SUMMARY, plan: [promise] });
    const skipped = (await call(app, 'GET', `${DIARY}/weeks/2026-11-09`, flagged)).json().data;
    expect(skipped.plan).toEqual([{ ...promise, done: undefined, source: 'carried' }]);
    const later = (await call(app, 'GET', `${DIARY}/weeks/2027-01-04`, flagged)).json().data;
    expect(later.plan).toEqual([]);
  });

  it('итог не ссылается на запись, которую удалили или перенесли на другую неделю', async () => {
    const { app } = await setup();
    const kept = await write(app, flagged, '2026-11-10', 'result', 'Осталась.');
    const moved = await write(app, flagged, '2026-11-11', 'result', 'Перенесена.');
    const removed = await write(app, flagged, '2026-11-12', 'result', 'Удалена.');
    await call(app, 'PUT', `${DIARY}/weeks/2026-11-09`, flagged, {
      ...SUMMARY,
      achievedEntryIds: [kept.id, moved.id, removed.id],
    });
    await call(app, 'PATCH', `${DIARY}/entries/${moved.id}`, flagged, { date: '2026-11-17' });
    await call(app, 'DELETE', `${DIARY}/entries/${removed.id}`, flagged);
    const draft = (await call(app, 'GET', `${DIARY}/weeks/2026-11-09`, flagged)).json().data;
    expect(draft.saved.achievedEntryIds).toEqual([kept.id]);
  });

  it('удаление кандидата стирает его записи и итоги', async () => {
    const { app, candidateStore, sessions, databasePath } = await setup();
    await write(app, flagged, '2026-11-11', 'result', 'Релиз вышел за 5 дней.');
    await write(app, other, '2026-11-11', 'note', 'Запись другого кандидата.');
    await call(app, 'PUT', `${DIARY}/weeks/2026-11-09`, flagged, { ...SUMMARY, blockers: 'Среда' });
    candidateStore.deleteCandidate(sessions.get(flagged)!.candidate!.id);
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const count = (table: string) =>
      (database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total;
    expect(count('career_diary_entries')).toBe(1);
    expect(count('career_diary_week_summaries')).toBe(0);
    database.close();
  });

  it('хранилище не создаёт запись сверх предела, повтор по ключу пределом не считается', async () => {
    const { candidateStore, sessions } = await setup();
    const candidateId = sessions.get(flagged)!.candidate!.id;
    const repo = candidateStore.diaryEntryRepo;
    const input = { date: '2026-11-11', kind: 'note' as const, text: 'Заметка' };
    const first = repo.create(candidateId, input, 'key-1', undefined, 1);
    expect(first).not.toBeNull();
    expect(repo.create(candidateId, input, 'key-2', undefined, 1)).toBeNull();
    expect(repo.create(candidateId, input, 'key-1', undefined, 1)?.id).toBe(first?.id);
    expect(repo.count(candidateId)).toBe(1);
  });

  it('выгрузка данных кандидата содержит записи и итоги', async () => {
    const { app, candidateStore, sessions } = await setup();
    await write(app, flagged, '2026-11-11', 'result', 'Релиз вышел за 5 дней.');
    await call(app, 'PUT', `${DIARY}/weeks/2026-11-09`, flagged, { ...SUMMARY, blockers: 'Среда' });
    const candidateId = sessions.get(flagged)!.candidate!.id;
    const exported = candidateStore.exportCandidate(candidateId).careerDiaryEntries;
    expect(exported.entries.map((entry) => entry.text)).toEqual(['Релиз вышел за 5 дней.']);
    expect(exported.weekSummaries.map((summary) => summary.blockers)).toEqual(['Среда']);
  });
});
