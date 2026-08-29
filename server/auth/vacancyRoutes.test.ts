import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { ServerConfig } from '../config';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import type { CoachProvider } from '../providers/coachProvider';
import { AuthService } from './authService';

const resources: Array<{
  app: Awaited<ReturnType<typeof buildApp>>;
  auth: AuthService;
  candidates: SqliteCandidateStore;
  directory: string;
}> = [];

const provider: CoachProvider = {
  async createTurn() {
    throw new Error('coach_provider_not_used');
  },
};

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.app.close();
    resource.auth.close();
    resource.candidates.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

async function createApp(
  searchVacancies?: Parameters<typeof buildApp>[0]['searchVacancies'],
  searchRemotive?: Parameters<typeof buildApp>[0]['searchRemotive'],
) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-vacancy-routes-'));
  const databasePath = join(directory, 'app.db');
  const candidates = new SqliteCandidateStore({
    databasePath,
    encryptionKey: Buffer.alloc(32, 8),
  });
  const auth = new AuthService({ databasePath });
  await auth.seedAccounts(
    [
      {
        username: 'candidate.test',
        password: 'candidate-password-for-tests',
        role: 'candidate',
      },
    ],
    candidates,
  );
  const config: ServerConfig = {
    host: '127.0.0.1',
    port: 3210,
    openAIKey: 'not-used-by-test',
    openRouterKey: 'not-used-by-test',
    previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
    dataEncryptionKey: Buffer.alloc(32, 8),
    databasePath,
    model: 'gpt-5.6-sol',
    staticRoot: directory,
    release: 'test',
    logLevel: 'fatal',
    secureCookies: false,
    allowedOrigins: ['http://localhost:3000'],
    seedAccounts: [],
  };
  const app = await buildApp({
    config,
    coachProvider: provider,
    candidateStore: candidates,
    authService: auth,
    serveStatic: false,
    ...(searchVacancies ? { searchVacancies } : {}),
    ...(searchRemotive ? { searchRemotive } : {}),
  });
  resources.push({ app, auth, candidates, directory });
  return app;
}

async function login(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: 'http://localhost:3000' },
    payload: {
      username: 'candidate.test',
      password: 'candidate-password-for-tests',
    },
  });
  return String(response.headers['set-cookie']).split(';')[0];
}

describe('candidate vacancy routes', () => {
  it('creates and immediately refreshes a recurring hh search', async () => {
    const app = await createApp(async ({ text }) => ({
      source: 'hh',
      query: text,
      found: 17,
      fetchedAt: '2026-08-13T11:00:00.000Z',
      items: [
        {
          id: '1771',
          title: 'Head of Operations',
          company: 'Synthetic Company',
          location: 'Москва',
          sourceUrl: 'https://hh.ru/vacancy/1771',
          publishedAt: null,
          salary: null,
          workMode: 'unknown',
          requirements: [],
        },
      ],
    }));
    const cookie = await login(app);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancy-subscriptions',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {
        source: 'hh',
        query: 'Head of Operations',
        cadenceMinutes: 360,
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({
      subscription: {
        query: 'Head of Operations',
        status: 'active',
        lastSuccessAt: '2026-08-13T11:00:00.000Z',
        analytics: { sampleSize: 1, sourceFound: 17 },
      },
      vacancies: [{ externalId: '1771', title: 'Head of Operations' }],
    });
  });

  it('exposes the dated source registry and persisted health', async () => {
    const app = await createApp();
    const cookie = await login(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/vacancy-sources',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'hh',
          transport: 'official_api',
          // hh.ru refuses the unauthenticated search; the registry says so
          // before a candidate spends a search direction on it (B175, INC-022).
          health: expect.objectContaining({ status: 'official_access_required' }),
        }),
        expect.objectContaining({
          id: 'remotive',
          transport: 'public_api',
          health: expect.objectContaining({ status: 'not_checked' }),
        }),
      ]),
    );
  });

  it('creates a Remotive subscription through the shared API', async () => {
    const app = await createApp(undefined, async ({ text }) => ({
      source: 'remotive',
      query: text,
      found: 1,
      fetchedAt: '2026-08-13T12:00:00.000Z',
      items: [
        {
          id: 'product-manager-berlin-101',
          title: 'Product Manager',
          company: 'Synthetic GmbH',
          location: 'Berlin',
          sourceUrl: 'https://jobs.example.test/product-101',
          publishedAt: '2026-08-12T06:40:00.000Z',
          salary: null,
          workMode: 'remote',
          requirements: ['Product'],
        },
      ],
    }));
    const cookie = await login(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancy-subscriptions',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {
        source: 'remotive',
        query: 'product manager',
        cadenceMinutes: 360,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      subscription: {
        source: 'remotive',
        lastSuccessAt: '2026-08-13T12:00:00.000Z',
      },
      vacancies: [
        {
          source: 'remotive',
          workMode: 'remote',
          requirements: ['Product'],
        },
      ],
    });
  });

  it('reports official access requirements without marking stale data healthy', async () => {
    const app = await createApp(async () => {
      throw new Error('hh_vacancy_search_official_access_required');
    });
    const cookie = await login(app);
    const headers = { cookie, origin: 'http://localhost:3000' };
    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancy-subscriptions',
      headers,
      payload: {
        source: 'hh',
        query: 'Head of Operations',
        cadenceMinutes: 360,
      },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/vacancy-sources',
      headers: { cookie },
    });

    expect(response.json().data[0]).toMatchObject({
      id: 'hh',
      health: {
        status: 'official_access_required',
        lastErrorCode: 'official_access_required',
        consecutiveFailures: 1,
      },
    });
  });

  it('pauses, manually refreshes and deletes a saved search', async () => {
    let fetchedAt = '2026-08-13T12:00:00.000Z';
    const app = await createApp(async ({ text }) => ({
      source: 'hh',
      query: text,
      found: 0,
      fetchedAt,
      items: [],
    }));
    const cookie = await login(app);
    const headers = { cookie, origin: 'http://localhost:3000' };
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancy-subscriptions',
      headers,
      payload: {
        source: 'hh',
        query: 'operations director',
        cadenceMinutes: 360,
      },
    });
    const subscriptionId = created.json().data.subscription.id as string;
    const paused = await app.inject({
      method: 'PATCH',
      url: `/api/v1/candidate/vacancy-subscriptions/${subscriptionId}`,
      headers,
      payload: { status: 'paused' },
    });
    expect(paused.json().data.status).toBe('paused');

    fetchedAt = '2026-08-13T13:00:00.000Z';
    const refreshed = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/vacancy-subscriptions/${subscriptionId}/refresh`,
      headers,
    });
    expect(refreshed.json().data.subscription).toMatchObject({
      status: 'paused',
      lastSuccessAt: fetchedAt,
    });
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/candidate/vacancy-subscriptions/${subscriptionId}`,
      headers,
    });
    expect(deleted.statusCode).toBe(204);
  });
});
