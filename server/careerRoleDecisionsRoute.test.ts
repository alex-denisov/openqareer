import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';

async function createApp() {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  candidateStore.saveResumeDraft(candidate.id, { ...EMPTY_RESUME_DRAFT, targetRole: 'CTO' }, []);
  const app = await buildApp({
    config,
    coachProvider: successProvider,
    candidateStore,
    authService: noSessions,
    serveStatic: false,
    roleNamer: {
      async nameRoles() {
        return {
          roles: [{ title: 'CTO', reason: 'вёл платформу', evidenceRefs: ['memory:1'] }],
          stage: 'gemini:gemini-3.6-flash',
        };
      },
    },
  });
  apps.push(app);
  stores.push(candidateStore);
  return { app, authorization: `Bearer ${candidate.accessToken}` };
}

describe('решения кандидата по ролям «Карьеры» (B445)', () => {
  it('отклонённая роль и скрытое предложение возвращаются в meta после перезапроса', async () => {
    const { app, authorization } = await createApp();
    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/role-hypotheses',
      headers: { authorization },
    });
    const roleId = first.json().data[0].id as string;
    expect(first.json().meta.roleDecisions).toEqual({ rejected: [], offersDismissed: [] });
    expect(first.json().meta.sample).toEqual({ observedAt: null, sources: [] });

    for (const proposalKey of [`career-role:${roleId}`, `career-role-offer:${roleId}`]) {
      const saved = await app.inject({
        method: 'POST',
        url: '/api/v1/coach/proposals/reject',
        headers: { authorization, origin: 'http://localhost:3000' },
        payload: { proposalKey },
      });
      expect(saved.statusCode).toBe(200);
    }

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/role-hypotheses',
      headers: { authorization },
    });
    expect(after.json().meta.roleDecisions).toEqual({
      rejected: [roleId],
      offersDismissed: [roleId],
    });
  });
});

describe('география поиска в профиле ограничений (B445)', () => {
  it('сохраняет города поиска отдельно от гражданства', async () => {
    const { app, authorization } = await createApp();
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/decision-profile',
      headers: { authorization, origin: 'http://localhost:3000' },
      payload: { citizenship: ['RU'], searchLocations: ['Москва', 'Удалённо из РФ'] },
    });
    expect(saved.statusCode).toBe(200);
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/decision-profile',
      headers: { authorization },
    });
    expect(read.json().data).toMatchObject({
      citizenship: ['RU'],
      searchLocations: ['Москва', 'Удалённо из РФ'],
    });
  });
});
