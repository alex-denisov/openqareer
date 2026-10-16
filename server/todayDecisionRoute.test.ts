import { describe, expect, it } from 'vitest';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';

const URL = '/api/v1/candidate/today/decision';
const workspace = {
  resumeText: '',
  resumeSource: 'text' as const,
  targetDirection: '',
  regions: [],
  currentSituation: '',
  constraints: '',
  urgency: 'exploring' as const,
};

async function setup() {
  const store = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  stores.push(store);
  const owner = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const other = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  store.saveResumeDraft(owner.id, EMPTY_RESUME_DRAFT, []);
  store.saveCandidateWorkspace(owner.id, workspace);
  store.saveCandidateWorkspace(other.id, workspace);
  const application = store.createApplication(owner.id, {
    clusterId: 'decision-fixture',
    stage: 'interview',
  });
  store.patchApplication(owner.id, application.id, {
    expectedVersion: application.version,
    followUpDueAt: '2026-01-01T00:00:00.000Z',
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
    store,
    owner,
    other,
    application,
    headers: { authorization: `Bearer ${owner.accessToken}` },
  };
}

describe('candidate-owned Today decision', () => {
  it('persists acceptance and rejection and exposes the current selection on reload', async () => {
    const { app, store, owner, application, headers } = await setup();
    for (const resolution of ['accepted', 'dismissed']) {
      const response = await app.inject({
        method: 'POST',
        url: URL,
        headers,
        payload: { applicationId: application.id, resolution },
      });
      expect(response.statusCode).toBe(200);
      expect(store.getCandidateWorkspace(owner.id)?.todayDecisionSelection?.resolution).toBe(
        resolution,
      );
      const today = await app.inject({ url: '/api/v1/candidate/today?tz=Europe/Moscow', headers });
      expect(today.statusCode, today.body).toBe(200);
      expect(today.json().data.todayDecisionSelection).toMatchObject({
        applicationId: application.id,
        resolution,
      });
    }
    // A stale workspace form cannot erase the server-owned decision.
    await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/workspace',
      headers,
      payload: { workspace },
    });
    expect(store.getCandidateWorkspace(owner.id)?.todayDecisionSelection?.resolution).toBe(
      'dismissed',
    );
  });

  it("rejects another candidate's task and unknown or stale tasks", async () => {
    const { app, application, other } = await setup();
    for (const applicationId of [application.id, 'missing']) {
      const response = await app.inject({
        method: 'POST',
        url: URL,
        headers: { authorization: `Bearer ${other.accessToken}` },
        payload: { applicationId, resolution: 'accepted' },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('decision_stale');
    }
  });

  it('requires authentication, safe origin and a valid resolution', async () => {
    const { app, application, headers } = await setup();
    const payload = { applicationId: application.id, resolution: 'accepted' };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: URL,
          headers: { origin: 'http://localhost:3000' },
          payload,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: URL,
          headers: { origin: 'https://attacker.invalid' },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: URL,
          headers,
          payload: { ...payload, resolution: 'sent' },
        })
      ).statusCode,
    ).toBe(422);
  });
});
