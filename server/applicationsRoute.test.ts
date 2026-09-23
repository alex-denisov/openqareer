import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';

/**
 * Трекер откликов, срез 1 (B251, architecture.md §6 QA):
 * - контракт `/vacancy-applications` не изменился;
 * - этап не понижается старым клиентом;
 * - перенос повторно ничего не дублирует;
 * - 409 на устаревшей версии.
 */
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
const APPLICATIONS_URL = '/api/v1/candidate/applications';
const LEGACY_URL = '/api/v1/candidate/vacancy-applications';

const vacancy = {
  title: 'Продуктовый аналитик',
  company: 'FinCloud',
  url: 'https://example.test/jobs/1',
  source: 'src-remotive',
};

describe('applications route · CRUD', () => {
  it('creates a card and lists it back', async () => {
    const { app, authorization } = await createApp();

    const created = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', stage: 'saved', manualVacancy: vacancy },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().data.stage).toBe('saved');
    expect(created.json().data.version).toBe(1);

    const list = await app.inject({ method: 'GET', url: APPLICATIONS_URL, headers: { authorization } });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);
  });

  it('repeated POST with the same clusterId does not duplicate the card', async () => {
    const { app, authorization } = await createApp();
    await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', stage: 'saved', manualVacancy: vacancy },
    });
    await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', stage: 'saved', manualVacancy: vacancy },
    });
    const list = await app.inject({ method: 'GET', url: APPLICATIONS_URL, headers: { authorization } });
    expect(list.json().data).toHaveLength(1);
  });

  it('PATCH allows a manual transition in any direction and bumps version', async () => {
    const { app, authorization } = await createApp();
    const created = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', stage: 'interview', manualVacancy: vacancy },
    });
    const id = created.json().data.id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `${APPLICATIONS_URL}/${id}`,
      headers: { authorization, ...ORIGIN },
      payload: { expectedVersion: 1, stage: 'applied' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.stage).toBe('applied');
    expect(patched.json().data.version).toBe(2);
  });

  it('returns 409 on a stale expectedVersion', async () => {
    const { app, authorization } = await createApp();
    const created = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', stage: 'saved', manualVacancy: vacancy },
    });
    const id = created.json().data.id;
    await app.inject({
      method: 'PATCH',
      url: `${APPLICATIONS_URL}/${id}`,
      headers: { authorization, ...ORIGIN },
      payload: { expectedVersion: 1, stage: 'applied' },
    });
    const stale = await app.inject({
      method: 'PATCH',
      url: `${APPLICATIONS_URL}/${id}`,
      headers: { authorization, ...ORIGIN },
      payload: { expectedVersion: 1, stage: 'responded' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('application_version_conflict');
  });

  it('requires a candidate session for every verb', async () => {
    const { app } = await createApp();
    expect((await app.inject({ method: 'GET', url: APPLICATIONS_URL })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: APPLICATIONS_URL,
          headers: ORIGIN,
          payload: { clusterId: 'cluster-1', stage: 'saved' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('rejects a mutating request from an unlisted origin without a bearer token', async () => {
    const { app } = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL,
      headers: { origin: 'https://attacker.test' },
      payload: { clusterId: 'cluster-1', stage: 'saved' },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('applications route · legacy dual-write (architecture.md §4)', () => {
  it('does not change the /vacancy-applications contract', async () => {
    const { app, authorization } = await createApp();
    const opened = await app.inject({
      method: 'POST',
      url: LEGACY_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', status: 'opened', vacancy },
    });
    expect(opened.statusCode).toBe(200);
    expect(Object.keys(opened.json().data).sort()).toEqual(
      ['appliedAt', 'clusterId', 'confirmedBy', 'openedAt', 'status', 'vacancy'].sort(),
    );

    const applied = await app.inject({
      method: 'POST',
      url: LEGACY_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', status: 'applied', vacancy },
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().data.status).toBe('applied');
    expect(applied.json().data.confirmedBy).toBe('candidate');
  });

  it('a confirmed legacy applied advances a fresh tracker card to applied', async () => {
    const { app, authorization } = await createApp();
    await app.inject({
      method: 'POST',
      url: LEGACY_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', status: 'applied', vacancy },
    });
    const list = await app.inject({ method: 'GET', url: APPLICATIONS_URL, headers: { authorization } });
    expect(list.json().data).toHaveLength(1);
    expect(list.json().data[0].stage).toBe('applied');
  });

  it('never downgrades a card the tracker already moved past applied', async () => {
    const { app, authorization } = await createApp();
    const created = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', stage: 'interview', manualVacancy: vacancy },
    });
    expect(created.statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: LEGACY_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', status: 'applied', vacancy },
    });

    const list = await app.inject({ method: 'GET', url: APPLICATIONS_URL, headers: { authorization } });
    expect(list.json().data).toHaveLength(1);
    expect(list.json().data[0].stage).toBe('interview');
  });
});

describe('applications route · lazy migration (architecture.md §5)', () => {
  it('migrates an old confirmed applied row on first GET, idempotently', async () => {
    const { app, authorization } = await createApp();
    await app.inject({
      method: 'POST',
      url: LEGACY_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-legacy', status: 'applied', vacancy },
    });

    const first = await app.inject({ method: 'GET', url: APPLICATIONS_URL, headers: { authorization } });
    expect(first.json().data).toHaveLength(1);
    expect(first.json().data[0].stage).toBe('applied');

    const second = await app.inject({ method: 'GET', url: APPLICATIONS_URL, headers: { authorization } });
    expect(second.json().data).toHaveLength(1);
  });

  it('does not migrate an opened-only legacy row: opening is not "Хочу"', async () => {
    const { app, authorization } = await createApp();
    await app.inject({
      method: 'POST',
      url: LEGACY_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-opened', status: 'opened', vacancy },
    });

    const list = await app.inject({ method: 'GET', url: APPLICATIONS_URL, headers: { authorization } });
    expect(list.json().data).toHaveLength(0);
  });
});
