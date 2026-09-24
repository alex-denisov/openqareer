import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';

/** `POST /visits` (B251, S4, architecture.md §4, §56). */
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
  return { app, authorization: `Bearer ${candidate.accessToken}` };
}

const ORIGIN = { origin: 'http://localhost:3000' };
const VISITS_URL = '/api/v1/candidate/visits';

describe('POST /candidate/visits', () => {
  it('returns since: null on the first visit', async () => {
    const { app, authorization } = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: VISITS_URL,
      headers: { authorization, ...ORIGIN },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.since).toBeNull();
  });

  it('returns the previous visit mark on a later call', async () => {
    const { app, authorization } = await createApp();

    await app.inject({ method: 'POST', url: VISITS_URL, headers: { authorization, ...ORIGIN } });
    const second = await app.inject({ method: 'POST', url: VISITS_URL, headers: { authorization, ...ORIGIN } });

    expect(second.statusCode).toBe(200);
    expect(typeof second.json().data.since).toBe('string');
  });

  it('requires an authenticated candidate', async () => {
    const { app } = await createApp();

    const response = await app.inject({ method: 'POST', url: VISITS_URL, headers: ORIGIN });

    expect(response.statusCode).toBe(401);
  });
});
