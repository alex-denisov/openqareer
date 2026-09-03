import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';

/** Двенадцать выборов с двумя выраженными предпочтениями: края различимы. */
const separatingAnswers = [
  { taskId: 'monday', optionId: 'monday-queue' },
  { taskId: 'shift', optionId: 'shift-schedule' },
  { taskId: 'end-of-shift', optionId: 'end-of-shift-schedule' },
  { taskId: 'half-done', optionId: 'half-done-finish' },
  { taskId: 'week', optionId: 'week-build' },
  { taskId: 'worse', optionId: 'worse-research-nothing' },
  { taskId: 'day-done', optionId: 'day-done-numbers' },
  { taskId: 'explain', optionId: 'explain-form' },
  { taskId: 'people', optionId: 'people-grow' },
  { taskId: 'easier', optionId: 'easier-touch' },
  { taskId: 'one-hour', optionId: 'one-hour-persuade' },
  { taskId: 'first-day', optionId: 'first-day-open' },
];

async function createApp() {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  candidateStore.saveResumeDraft(
    candidate.id,
    { ...EMPTY_RESUME_DRAFT, targetRole: 'Продакт-менеджер' },
    [],
  );
  const app = await buildApp({
    config,
    coachProvider: successProvider,
    candidateStore,
    authService: noSessions,
    serveStatic: false,
    roleNamer: {
      async nameRoles() {
        return {
          roles: [
            { title: 'Operations Manager', reason: 'вёл операции', evidenceRefs: ['memory:1'] },
            { title: 'Data Analyst', reason: 'считал когорты', evidenceRefs: ['memory:2'] },
          ],
          stage: 'gemini:gemini-3.6-flash',
        };
      },
    },
  });
  apps.push(app);
  stores.push(candidateStore);
  return { app, authorization: `Bearer ${candidate.accessToken}` };
}

const ORIGIN = { origin: 'http://localhost:3000' };

describe('work preferences route', () => {
  it('отдаёт задания вместе с версией ключа и без ответов', async () => {
    const { app, authorization } = await createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/work-preferences',
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.keyVersion).toBe('work-preferences-pairs-v1');
    expect(data.tasks).toHaveLength(12);
    // До прохождения результата нет — и это не ошибка.
    expect(data.run).toBeNull();
  });

  it('без сессии кандидата ни заданий, ни записи ответов', async () => {
    const { app } = await createApp();

    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/candidate/work-preferences' })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/candidate/work-preferences',
          headers: ORIGIN,
          payload: { answers: separatingAnswers, excluded: [] },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('считает доли со знаменателями и не выдаёт сводного балла', async () => {
    const { app, authorization } = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/work-preferences',
      headers: { authorization, ...ORIGIN },
      payload: { answers: separatingAnswers, excluded: [] },
    });

    expect(response.statusCode).toBe(200);
    const result = response.json().data.result;
    expect(result.discriminates).toBe(true);
    expect(result.counts.find((count: { family: string }) => count.family === 'ПП')).toMatchObject({
      value: 3,
      total: 3,
    });
    expect(JSON.stringify(result)).not.toContain('score');
  });

  it('ответы переживают запрос и читаются следующим входом', async () => {
    const { app, authorization } = await createApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/work-preferences',
      headers: { authorization, ...ORIGIN },
      payload: { answers: separatingAnswers, excluded: ['ЗФ'] },
    });

    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/work-preferences',
      headers: { authorization },
    });

    expect(read.json().data.run.result.excluded).toEqual(['ЗФ']);
    expect(read.json().data.run.keyVersion).toBe('work-preferences-pairs-v1');
  });

  it('порядок ролей в гипотезах меняется ответами, а состав — нет', async () => {
    const { app, authorization } = await createApp();
    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/role-hypotheses',
      headers: { authorization },
    });
    const beforeTitles = before.json().data.map((role: { title: string }) => role.title);

    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/work-preferences',
      headers: { authorization, ...ORIGIN },
      payload: { answers: separatingAnswers, excluded: [] },
    });

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/role-hypotheses',
      headers: { authorization },
    });
    const afterTitles = after.json().data.map((role: { title: string }) => role.title);

    // «Порядок и поток» — верх ответов, поэтому Operations Manager впереди.
    expect(afterTitles[0]).toBe('Operations Manager');
    expect([...afterTitles].sort()).toEqual([...beforeTitles].sort());
  });

  it('чужая страница ответов не записывает', async () => {
    const { app } = await createApp();

    const foreign = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/work-preferences',
      headers: { origin: 'https://attacker.example' },
      payload: { answers: separatingAnswers, excluded: [] },
    });

    expect(foreign.statusCode).toBe(403);
  });

  it('мусор в ответах отклоняется схемой, а не считается', async () => {
    const { app, authorization } = await createApp();

    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/work-preferences',
      headers: { authorization, ...ORIGIN },
      payload: { answers: 'всё', excluded: ['нет такого'] },
    });

    // Тело, не прошедшее схему, отклоняется тем же 422, что и везде в API.
    expect(bad.statusCode).toBe(422);
  });
});
