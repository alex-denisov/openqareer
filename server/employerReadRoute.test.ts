import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';

/** B543: ручная отметка «прочитано» даёт полосе «Сегодня» событие «открыл письмо», отмена его снимает. */
const SINCE = '2026-01-01T15:40:00.000Z';
const ORIGIN = { origin: 'http://localhost:3000' };

async function setup() {
  const store = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  stores.push(store);
  const owner = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const other = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  store.saveResumeDraft(owner.id, EMPTY_RESUME_DRAFT, []);
  store.saveCandidateWorkspace(owner.id, {
    resumeText: '',
    resumeSource: 'text',
    targetDirection: '',
    regions: [],
    currentSituation: '',
    constraints: '',
    urgency: 'exploring',
    lastVisitedAt: new Date().toISOString(),
    previousVisitedAt: SINCE,
  });
  const vacancy = {
    title: 'Head of Platform',
    company: 'Вектор Банк',
    url: 'https://example.test/v',
    source: 'other' as const,
  };
  const application = store.createApplication(owner.id, { stage: 'applied', vacancy });
  const draft = store.createApplication(owner.id, {
    stage: 'saved',
    vacancy: { ...vacancy, company: 'Гринкод' },
  });
  const app = await buildApp({
    config,
    coachProvider: successProvider,
    candidateStore: store,
    authService: noSessions,
    serveStatic: false,
  });
  apps.push(app);
  return {
    app,
    application,
    draft,
    headers: { authorization: `Bearer ${owner.accessToken}`, ...ORIGIN },
    otherHeaders: { authorization: `Bearer ${other.accessToken}`, ...ORIGIN },
  };
}

async function todayChanges(
  app: Awaited<ReturnType<typeof setup>>['app'],
  headers: Record<string, string>,
) {
  const today = await app.inject({ url: '/api/v1/candidate/today?tz=Europe/Moscow', headers });
  expect(today.statusCode, today.body).toBe(200);
  return today.json().data.sinceLastVisit.changes;
}

describe('employer read mark (B543)', () => {
  it('marks the application read by the candidate, feeds Today and undoes both', async () => {
    const { app, application, headers } = await setup();
    const url = `/api/v1/candidate/applications/${application.id}/employer-read`;
    expect((await app.inject({ url, headers })).json().data).toBeNull();
    expect(await todayChanges(app, headers)).toEqual([]);

    const marked = await app.inject({ method: 'POST', url, headers, payload: {} });
    expect(marked.statusCode, marked.body).toBe(200);
    expect(marked.json().data).toMatchObject({ source: 'candidate' });
    expect(Date.parse(marked.json().data.readAt)).not.toBeNaN();
    expect((await app.inject({ url, headers })).json().data).toEqual(marked.json().data);
    expect(await todayChanges(app, headers)).toMatchObject([
      { kind: 'letter_opened', company: 'Вектор Банк', applicationId: application.id },
    ]);

    const again = await app.inject({ method: 'POST', url, headers, payload: {} });
    expect(again.statusCode).toBe(200);
    expect(await todayChanges(app, headers)).toHaveLength(1);

    const undone = await app.inject({ method: 'DELETE', url, headers });
    expect(undone.statusCode, undone.body).toBe(200);
    expect((await app.inject({ url, headers })).json().data).toBeNull();
    expect(await todayChanges(app, headers)).toEqual([]);
  });

  it('refuses another candidate and an unsent draft', async () => {
    const { app, application, draft, headers, otherHeaders } = await setup();
    const foreign = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/applications/${application.id}/employer-read`,
      headers: otherHeaders,
      payload: {},
    });
    expect(foreign.statusCode).toBe(404);
    const unsent = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/applications/${draft.id}/employer-read`,
      headers,
      payload: {},
    });
    expect(unsent.statusCode).toBe(409);
  });
});
