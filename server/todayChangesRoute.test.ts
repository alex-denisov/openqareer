import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';

/** B542: напоминание называет контакт отклика, полоса «С ДД.ММ» — из событий, «Скрыть» — на сервере. */
const SINCE = '2026-01-01T15:40:00.000Z';

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
  const application = store.createApplication(owner.id, {
    stage: 'applied',
    vacancy: {
      title: 'Head of Engineering',
      company: 'Вектор Банк',
      url: 'https://example.test/vector',
      source: 'other',
    },
  });
  store.patchApplication(owner.id, application.id, {
    expectedVersion: application.version,
    followUpDueAt: '2026-01-02T00:00:00.000Z',
  });
  store.notificationRepository.recordEvent(owner.id, {
    idempotencyKey: 'opened-1',
    kind: 'employer_opened_letter',
    sourceType: 'application',
    sourceId: application.id,
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
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
    headers: { authorization: `Bearer ${owner.accessToken}` },
    otherHeaders: { authorization: `Bearer ${other.accessToken}` },
  };
}

describe('Today changes strip and reminder contact (B542)', () => {
  it('names the saved contact on the follow-up row', async () => {
    const { app, application, headers, otherHeaders } = await setup();
    const url = `/api/v1/candidate/applications/${application.id}/contact`;
    const foreign = await app.inject({
      method: 'PUT',
      url,
      headers: otherHeaders,
      payload: { name: 'X Y' },
    });
    expect(foreign.statusCode).toBe(404);
    const invalid = await app.inject({
      method: 'PUT',
      url,
      headers,
      payload: { name: 'x'.repeat(200) },
    });
    expect(invalid.statusCode).toBe(422);
    const saved = await app.inject({
      method: 'PUT',
      url,
      headers,
      payload: { name: 'Мария Орлова' },
    });
    expect(saved.statusCode, saved.body).toBe(200);

    const today = await app.inject({ url: '/api/v1/candidate/today?tz=Europe/Moscow', headers });
    const row = today
      .json()
      .data.queue.find((item: { applicationId?: string }) => item.applicationId === application.id);
    expect(row).toMatchObject({ kind: 'follow_up', contactName: 'Мария Орлова' });
  });

  it('shows the opened letter since the last visit and hides it after dismissal', async () => {
    const { app, application, headers } = await setup();
    const before = await app.inject({ url: '/api/v1/candidate/today?tz=Europe/Moscow', headers });
    expect(before.statusCode, before.body).toBe(200);
    expect(before.json().data.sinceLastVisit).toMatchObject({
      since: SINCE,
      changes: [{ kind: 'letter_opened', company: 'Вектор Банк', applicationId: application.id }],
    });

    const dismissed = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/today/changes/dismiss',
      headers,
    });
    expect(dismissed.statusCode, dismissed.body).toBe(200);
    const after = await app.inject({ url: '/api/v1/candidate/today?tz=Europe/Moscow', headers });
    expect(after.json().data.sinceLastVisit.changes).toEqual([]);
  });
});
