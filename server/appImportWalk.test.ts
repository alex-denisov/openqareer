import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';

/** B541: the source walk and every fact's origin survive a reload. */
describe('import provenance and section walk', () => {
  async function createApp() {
    const candidateStore = new SqliteCandidateStore({
      databasePath: ':memory:',
      encryptionKey: config.dataEncryptionKey,
    });
    const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const app = await buildApp({
      config,
      coachProvider: successProvider,
      candidateStore,
      authService: noSessions,
      serveStatic: false,
    });
    apps.push(app);
    stores.push(candidateStore);
    return {
      app,
      candidateStore,
      candidateId: candidate.id,
      headers: {
        authorization: `Bearer ${candidate.accessToken}`,
        origin: config.allowedOrigins[0],
      },
    };
  }

  const walk = {
    state: 'running',
    sections: [
      { key: 'experience', status: 'read' },
      { key: 'education', status: 'read' },
      { key: 'skills', status: 'read' },
      { key: 'languages', status: 'pending' },
      { key: 'projects', status: 'failed' },
    ],
  };

  it('stores the last walk and returns it with the source', async () => {
    const { app, candidateStore, candidateId, headers } = await createApp();
    candidateStore.importResumeEvidence(candidateId, {
      sourceLabel: 'Импорт: профиль LinkedIn',
      platform: 'linkedin',
      entries: [
        { memoryId: 'li-1', domain: 'outcome', statement: 'Вёл платформу.' },
        { memoryId: 'li-2', domain: 'skill', statement: 'Kafka.' },
      ],
    });
    candidateStore.changeMemory(candidateId, 'li-2', { action: 'delete' });

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/connections/linkedin/walk',
      headers,
      payload: walk,
    });
    expect(saved.statusCode).toBe(200);

    const snapshot = await app.inject({ method: 'GET', url: '/api/v1/candidate/me', headers });
    const [source] = snapshot.json().data.importedSources;
    expect(source).toMatchObject({
      platform: 'linkedin',
      factCount: 2,
      keptFactCount: 1,
      walk: { platform: 'linkedin', state: 'running', sections: walk.sections },
    });

    const memory = await app.inject({ method: 'GET', url: '/api/v1/candidate/me/memory', headers });
    expect(memory.json().data[0].provenance).toEqual({
      kind: 'import',
      platform: 'linkedin',
      at: source.lastImportedAt,
    });

    const connections = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/connections',
      headers,
    });
    expect(connections.json().data[0]).toMatchObject({
      platform: 'linkedin',
      walk: { state: 'running' },
    });
  });

  it('rejects an unknown platform or a malformed section', async () => {
    const { app, headers } = await createApp();
    const unknown = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/connections/facebook/walk',
      headers,
      payload: walk,
    });
    expect(unknown.statusCode).toBe(400);
    const malformed = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/connections/linkedin/walk',
      headers,
      payload: { state: 'running', sections: [{ key: 'experience', status: 'maybe' }] },
    });
    expect(malformed.statusCode).toBe(400);
  });
});
