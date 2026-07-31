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
};

const noSessions: SessionAuth = {
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

async function createApp(provider: CoachProvider = successProvider) {
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
        fallbackModels: [
          'nvidia/nemotron-3-super-120b-a12b:free',
        ],
        outputValidation: 'server-side-strict-schema',
      },
      qualityFloor: 'gpt-5.6-sol',
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
});
