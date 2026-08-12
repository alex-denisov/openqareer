import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { ServerConfig } from './config';
import {
  CoachProviderError,
  type CoachProvider,
} from './providers/coachProvider';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { SessionAuth } from './auth/authService';
import type { HhVacancySample } from './connectors/hhVacancySearch';

const config: ServerConfig = {
  host: '127.0.0.1',
  port: 3210,
  openAIKey: 'not-used-by-test',
  openRouterKey: 'not-used-by-test',
  previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
  dataEncryptionKey: Buffer.alloc(32, 7),
  databasePath: ':memory:',
  model: 'gpt-5.6-sol',
  staticRoot: '/tmp/not-used',
  release: 'test-release',
  logLevel: 'fatal',
  secureCookies: false,
  allowedOrigins: ['http://localhost:3000'],
  seedAccounts: [],
  oauthProviders: {},
};

const noSessions: SessionAuth = {
  async register() {
    throw new Error('registration unavailable in this test double');
  },
  async login() {
    return null;
  },
  authenticate() {
    return null;
  },
  logout() {},
};

const successProvider: CoachProvider = {
  async createTurn() {
    return {
      provider: 'openai',
      model: 'gpt-5.6-sol',
      responseId: 'response-1',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      },
      result: {
        message: 'Уточним результат запуска.',
        phase: 'evidence',
        memoryCandidates: [],
        nextQuestion: 'Что изменилось после запуска?',
        completeness: {
          known: ['Есть опыт запуска'],
          unknown: ['Наблюдаемый результат'],
        },
        safety: {
          needsHuman: false,
          reason: null,
        },
        careerTrack: null,
        actionProposals: [],
      },
    };
  },
};

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const stores: SqliteCandidateStore[] = [];
const candidateTokens = new WeakMap<
  Awaited<ReturnType<typeof buildApp>>,
  string
>();

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  stores.splice(0).forEach((store) => store.close());
});

async function createApp(
  provider: CoachProvider = successProvider,
  searchVacancies?: () => Promise<HhVacancySample>,
  importProfile?: Parameters<typeof buildApp>[0]['importProfile'],
) {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({
    dataClass: 'synthetic',
    locale: 'ru-RU',
  });
  const app = await buildApp({
    config,
    coachProvider: provider,
    candidateStore,
    authService: noSessions,
    serveStatic: false,
    searchVacancies,
    importProfile,
  });
  apps.push(app);
  stores.push(candidateStore);
  candidateTokens.set(app, candidate.accessToken);
  return app;
}

const validPayload = {
  messageId: '85512ddf-962c-4a7c-a4cc-30a35d1e5847',
  content: 'Я запускал цифровой продукт.',
  phase: 'discovery',
};

function candidateAuthorization(
  app: Awaited<ReturnType<typeof buildApp>>,
): string {
  return `Bearer ${candidateTokens.get(app)}`;
}

describe('OpenQareer API boundary', () => {
  it('delegates a permitted profile transport only inside the candidate boundary', async () => {
    const app = await createApp(successProvider, undefined, async (url) => ({
      status: 'imported',
      platform: 'linkedin',
      sourceUrl: url,
      capturedAt: '2026-08-10T00:00:00.000Z',
      accessPath: 'official_api',
      facts: [{ kind: 'headline', value: 'Synthetic Product Lead', sourceLocator: 'public-meta:1', confidence: 'public-metadata' }],
    }));
    const unauthorized = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/profile-imports',
      headers: { origin: 'http://localhost:3000' },
      payload: { url: 'https://www.linkedin.com/in/synthetic-candidate' },
    });
    expect(unauthorized.statusCode).toBe(401);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/profile-imports',
      headers: {
        origin: 'http://localhost:3000',
        authorization: candidateAuthorization(app),
      },
      payload: { url: 'https://www.linkedin.com/in/synthetic-candidate' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ status: 'imported', facts: [{ value: 'Synthetic Product Lead' }] });
  });

  it('returns a source-labelled public vacancy sample without candidate credentials', async () => {
    const app = await createApp(successProvider, async () => ({
      source: 'hh',
      query: 'руководитель операций',
      found: 18,
      fetchedAt: '2026-08-07T13:00:00.000Z',
      items: [],
    }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/market/hh?text=руководитель%20операций',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        source: 'hh',
        found: 18,
        fetchedAt: '2026-08-07T13:00:00.000Z',
      },
    });
  });

  it('keeps health public and provider details authenticated', async () => {
    const app = await createApp();

    const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({
      data: { status: 'ok', release: 'test-release' },
    });

    const unauthorized = await app.inject({
      method: 'GET',
      url: '/api/v1/provider/status',
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json().error).toMatchObject({
      code: 'unauthorized',
      retryable: false,
    });

    const authorized = await app.inject({
      method: 'GET',
      url: '/api/v1/provider/status',
      headers: {
        authorization: `Bearer ${config.previewToken}`,
      },
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json().data).toMatchObject({
      personalDataRoute: {
        provider: 'openai',
        model: 'gpt-5.6-sol',
      },
      syntheticDataRoute: {
        provider: 'openrouter',
        model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        fallbackProviders: [],
        outputValidation: 'server-side-strict-schema',
      },
      qualityFloor: 'gpt-5.6-sol',
      promptRevision: 'career-v1.0-2026-08-07',
    });
  });

  it('validates idempotency and input before calling the model', async () => {
    const app = await createApp();
    const headers = {
      authorization: candidateAuthorization(app),
    };

    const missingKey = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers,
      payload: validPayload,
    });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json().error.code).toBe('idempotency_key_required');

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: {
        ...headers,
        'idempotency-key': randomUUID(),
      },
      payload: {
        messageId: randomUUID(),
        content: '',
      },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error).toMatchObject({
      code: 'validation_failed',
      retryable: false,
    });
  });

  it('returns structured coach output and provider provenance', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: {
        authorization: candidateAuthorization(app),
        'idempotency-key': randomUUID(),
      },
      payload: validPayload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        message: 'Уточним результат запуска.',
        phase: 'evidence',
      },
      meta: {
        provider: 'openai',
        model: 'gpt-5.6-sol',
        responseId: 'response-1',
      },
    });
  });

  it('keeps phase selection on the server instead of trusting the browser', async () => {
    let providerPhase: string | undefined;
    const provider: CoachProvider = {
      async createTurn(input) {
        providerPhase = input.phase;
        return successProvider.createTurn(input, randomUUID());
      },
    };
    const app = await createApp(provider);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: {
        authorization: candidateAuthorization(app),
        'idempotency-key': randomUUID(),
      },
      payload: { ...validPayload, phase: 'targeting' },
    });

    expect(response.statusCode).toBe(200);
    expect(providerPhase).toBe('discovery');
  });

  it('routes an explicit market request into the material three-role phase', async () => {
    let providerPhase: string | undefined;
    const provider: CoachProvider = {
      async createTurn(input) {
        providerPhase = input.phase;
        return successProvider.createTurn(input, randomUUID());
      },
    };
    const app = await createApp(provider);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: {
        authorization: candidateAuthorization(app),
        origin: 'http://localhost:3000',
        'idempotency-key': randomUUID(),
      },
      payload: {
        messageId: randomUUID(),
        content: 'Сравни рынок вакансий в Германии и России',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(providerPhase).toBe('market');
  });

  it('returns a stable retryable error without provider payloads', async () => {
    const provider: CoachProvider = {
      async createTurn() {
        throw new CoachProviderError(
          'provider_rate_limited',
          429,
          true,
        );
      },
    };
    const app = await createApp(provider);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: {
        authorization: candidateAuthorization(app),
        'idempotency-key': randomUUID(),
      },
      payload: validPayload,
    });

    expect(response.statusCode).toBe(429);
    expect(response.json().error).toMatchObject({
      code: 'provider_rate_limited',
      retryable: true,
    });
    expect(response.json().error.message).not.toBe('limited');

    const snapshot = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: {
        authorization: candidateAuthorization(app),
      },
    });
    expect(snapshot.json().data.messages).toEqual([
      {
        id: validPayload.messageId,
        role: 'user',
        content: validPayload.content,
      },
    ]);
  });

  it('creates one-time candidate credentials and isolates profiles', async () => {
    const app = await createApp();
    const unauthorized = await app.inject({
      method: 'POST',
      url: '/api/v1/candidates',
      payload: { dataClass: 'synthetic', locale: 'ru-RU' },
    });
    expect(unauthorized.statusCode).toBe(401);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/candidates',
      headers: {
        authorization: `Bearer ${config.previewToken}`,
      },
      payload: { dataClass: 'synthetic', locale: 'ru-RU' },
    });
    expect(created.statusCode).toBe(201);
    const credentials = created.json().data as {
      id: string;
      accessToken: string;
    };
    expect(credentials.accessToken).toMatch(/^oqc_/);

    const ownSnapshot = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: {
        authorization: `Bearer ${credentials.accessToken}`,
      },
    });
    expect(ownSnapshot.statusCode).toBe(200);
    expect(ownSnapshot.json().data).toMatchObject({
      candidate: { id: credentials.id },
      messages: [],
      memory: [],
    });

    const otherSnapshot = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: {
        authorization: candidateAuthorization(app),
      },
    });
    expect(otherSnapshot.json().data.candidate.id).not.toBe(credentials.id);
  });

  it('evaluates, stores and replaces candidate-scoped assessments', async () => {
    const app = await createApp();
    const authorization = candidateAuthorization(app);
    const preferences = {
      ambiguity: 5,
      evidence: 5,
      collaboration: 4,
      persuasion: 2,
      planning: 3,
      detail: 2,
      leadership: 3,
      craft: 4,
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/assessments/work-preferences-v1',
      headers: { authorization },
      payload: preferences,
    });
    expect(first.statusCode).toBe(200);
    const firstAssessment = first.json().data;
    expect(firstAssessment).toMatchObject({
      assessmentId: 'work-preferences-v1',
      result: { kind: 'work-preferences' },
    });
    expect(firstAssessment.result.roleFamilies[0].id).toBe(
      'product-discovery',
    );

    const revised = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/assessments/work-preferences-v1',
      headers: { authorization },
      payload: { ...preferences, planning: 5 },
    });
    expect(revised.statusCode).toBe(200);
    const snapshot = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: { authorization },
    });
    expect(snapshot.json().data.assessments).toHaveLength(1);
    expect(snapshot.json().data.assessments[0].submission.planning).toBe(5);

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/assessments/product-case-v1',
      headers: { authorization },
      payload: { firstMove: 'invent-the-answer' },
    });
    expect(invalid.statusCode).toBe(422);
  });

  it('evaluates and returns a dated Germany route without eligibility claims', async () => {
    const app = await createApp();
    const authorization = candidateAuthorization(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/markets/DE',
      headers: { authorization },
      payload: {
        workAuthorization: 'none',
        jobOffer: 'yes',
        grossAnnualSalaryEur: 55_000,
        offerDurationMonths: 24,
        qualification: 'recognized-comparable',
        professionRegulation: 'non-regulated',
        blueCardBand: 'general',
        fundsMonthlyEur: null,
        languageEvidence: 'english-b2-plus',
        relocationReadiness: 'ready',
        dependants: 'none',
        targetWorkMode: 'hybrid',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      country: 'DE',
      result: {
        packVersion: 'DE-2026.1',
        recommendedRouteId: 'eu-blue-card',
      },
    });
    const snapshot = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: { authorization },
    });
    expect(snapshot.json().data.germanyMarket.result.caveat).toMatch(
      /не юридическое решение/i,
    );
  });
});

describe('candidate platform connections', () => {
  const connectedProvider = {
    clientId: 'synthetic-client-id',
    clientSecret: 'synthetic-client-secret-value',
    redirectUri: 'https://openqareer.com/api/v1/connectors/hh/callback',
  };

  const hhConnection = {
    platform: 'hh' as const,
    externalAccountId: 'synthetic-applicant-1',
    scopes: ['profile_read', 'resume_read'],
    capabilities: ['profile_read', 'resume_read'] as const,
    accessToken: 'synthetic-access-token-value',
    refreshToken: 'synthetic-refresh-token-value',
    accessTokenExpiresAt: '2026-08-11T00:00:00.000Z',
    profile: {
      capturedAt: '2026-08-10T00:00:00.000Z',
      sourceUrl: 'https://hh.ru/resume/syntheticresume',
      facts: [
        {
          kind: 'headline' as const,
          value: 'Синтетический руководитель продукта',
          sourceLocator: 'hh:resume:synthetic:title',
          confidence: 'official-api' as const,
        },
      ],
    },
  };

  async function createConnectionsApp(
    options: {
      providers?: ServerConfig['oauthProviders'];
      transport?: Parameters<typeof buildApp>[0]['oauthTransport'];
    } = {},
  ) {
    const candidateStore = new SqliteCandidateStore({
      databasePath: ':memory:',
      encryptionKey: config.dataEncryptionKey,
    });
    const candidate = candidateStore.createCandidate({
      dataClass: 'synthetic',
      locale: 'ru-RU',
    });
    const app = await buildApp({
      config: {
        ...config,
        oauthProviders: options.providers ?? { hh: connectedProvider },
      },
      coachProvider: successProvider,
      candidateStore,
      authService: noSessions,
      serveStatic: false,
      oauthTransport: options.transport,
    });
    apps.push(app);
    stores.push(candidateStore);
    return { app, authorization: `Bearer ${candidate.accessToken}` };
  }

  async function startAuthorization(
    app: Awaited<ReturnType<typeof buildApp>>,
    authorization: string,
  ): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/connections/hh/authorizations',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(response.statusCode).toBe(201);
    return (
      new URL(response.json().data.authorizationUrl).searchParams.get(
        'state',
      ) ?? ''
    );
  }

  it('publishes an honest connection catalog only to the candidate session', async () => {
    const { app, authorization } = await createConnectionsApp();

    const unauthorized = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/connections',
    });
    expect(unauthorized.statusCode).toBe(401);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/connections',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json().data).toEqual([
      {
        platform: 'linkedin',
        available: false,
        status: 'disconnected',
        capabilities: ['lite_identity'],
        importsCareerHistory: false,
      },
      {
        platform: 'hh',
        available: true,
        status: 'disconnected',
        capabilities: ['profile_read', 'resume_read'],
        importsCareerHistory: true,
      },
    ]);
  });

  it('refuses authorization for an unconfigured provider and an unknown platform', async () => {
    const { app, authorization } = await createConnectionsApp();

    const unconfigured = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/connections/linkedin/authorizations',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(unconfigured.statusCode).toBe(503);
    expect(unconfigured.json().error).toMatchObject({
      code: 'connector_not_configured',
      retryable: false,
    });

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/connections/vk/authorizations',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('connector_not_found');

    const foreignOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/connections/hh/authorizations',
      headers: { origin: 'https://attacker.example' },
    });
    expect(foreignOrigin.statusCode).toBe(403);
  });

  it('returns a single-use authorization URL bound to the configured app', async () => {
    const { app, authorization } = await createConnectionsApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/connections/hh/authorizations',
      headers: { authorization, origin: 'http://localhost:3000' },
    });

    expect(response.statusCode).toBe(201);
    const authorizationUrl = new URL(response.json().data.authorizationUrl);
    expect(authorizationUrl.origin).toBe('https://hh.ru');
    expect(authorizationUrl.searchParams.get('client_id')).toBe(
      connectedProvider.clientId,
    );
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(
      connectedProvider.redirectUri,
    );
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe(
      'S256',
    );
    expect(response.payload).not.toContain(connectedProvider.clientSecret);
    expect(Date.parse(response.json().data.expiresAt)).toBeGreaterThan(
      Date.now(),
    );
  });

  it('stores one connection per callback and never replays a consumed state', async () => {
    const { app, authorization } = await createConnectionsApp({
      transport: {
        async connect() {
          return hhConnection;
        },
      },
    });
    const state = await startAuthorization(app, authorization);

    const callback = await app.inject({
      method: 'GET',
      url: `/api/v1/connectors/hh/callback?state=${state}&code=synthetic-code`,
    });
    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toBe(
      '/connections/result?platform=hh&status=connected',
    );

    const connections = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/connections',
      headers: { authorization },
    });
    expect(connections.json().data[1]).toMatchObject({
      platform: 'hh',
      status: 'connected',
      scopes: ['profile_read', 'resume_read'],
      profile: {
        sourceUrl: 'https://hh.ru/resume/syntheticresume',
        facts: [{ value: 'Синтетический руководитель продукта' }],
      },
    });
    expect(connections.payload).not.toContain(hhConnection.accessToken);
    expect(connections.payload).not.toContain(hhConnection.refreshToken);
    expect(connections.payload).not.toContain(hhConnection.externalAccountId);

    const replay = await app.inject({
      method: 'GET',
      url: `/api/v1/connectors/hh/callback?state=${state}&code=synthetic-code`,
    });
    expect(replay.statusCode).toBe(303);
    expect(replay.headers.location).toBe(
      '/connections/result?platform=hh&status=failed&reason=oauth_state_invalid',
    );
  });

  it('surfaces an upstream failure and a candidate refusal without a connection', async () => {
    const { app, authorization } = await createConnectionsApp({
      transport: {
        async connect() {
          throw new Error('upstream contract failure');
        },
      },
    });

    const failed = await app.inject({
      method: 'GET',
      url: `/api/v1/connectors/hh/callback?state=${await startAuthorization(
        app,
        authorization,
      )}&code=synthetic-code`,
    });
    expect(failed.statusCode).toBe(303);
    expect(failed.headers.location).toBe(
      '/connections/result?platform=hh&status=failed&reason=provider_oauth_failed',
    );

    const denied = await app.inject({
      method: 'GET',
      url: `/api/v1/connectors/hh/callback?state=${await startAuthorization(
        app,
        authorization,
      )}&error=access_denied`,
    });
    expect(denied.statusCode).toBe(303);
    expect(denied.headers.location).toBe(
      '/connections/result?platform=hh&status=declined',
    );

    const connections = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/connections',
      headers: { authorization },
    });
    expect(connections.json().data[1].status).toBe('disconnected');
  });

  it('disconnects idempotently and reports upstream revocation honestly', async () => {
    const { app, authorization } = await createConnectionsApp({
      transport: {
        async connect() {
          return hhConnection;
        },
      },
    });
    const state = await startAuthorization(app, authorization);
    await app.inject({
      method: 'GET',
      url: `/api/v1/connectors/hh/callback?state=${state}&code=synthetic-code`,
    });

    const foreignOrigin = await app.inject({
      method: 'DELETE',
      url: '/api/v1/candidate/connections/hh',
      headers: { origin: 'https://attacker.example' },
    });
    expect(foreignOrigin.statusCode).toBe(403);

    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/v1/candidate/connections/hh',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().data).toEqual({
      platform: 'hh',
      status: 'disconnected',
      localDataRemoved: true,
      upstreamRevocation: 'unsupported',
    });

    const again = await app.inject({
      method: 'DELETE',
      url: '/api/v1/candidate/connections/hh',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().data.localDataRemoved).toBe(false);

    const connections = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/connections',
      headers: { authorization },
    });
    expect(connections.json().data[1].status).toBe('disconnected');
  });
});
