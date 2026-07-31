import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { ServerConfig } from './config';
import {
  CoachProviderError,
  type CoachProvider,
} from './providers/coachProvider';

const config: ServerConfig = {
  host: '127.0.0.1',
  port: 3210,
  openAIKey: 'not-used-by-test',
  openRouterKey: 'not-used-by-test',
  previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
  model: 'gpt-5.6-sol',
  staticRoot: '/tmp/not-used',
  release: 'test-release',
  logLevel: 'fatal',
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

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function createApp(provider: CoachProvider = successProvider) {
  const app = await buildApp({
    config,
    coachProvider: provider,
    serveStatic: false,
  });
  apps.push(app);
  return app;
}

const validPayload = {
  candidateReference: 'candidate-test-001',
  messages: [
    {
      id: 'message-1',
      role: 'user',
      content: 'Я запускал цифровой продукт.',
    },
  ],
};

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
      },
      qualityFloor: 'gpt-5.6-sol',
    });
  });

  it('validates idempotency and input before calling the model', async () => {
    const app = await createApp();
    const headers = {
      authorization: `Bearer ${config.previewToken}`,
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
        candidateReference: 'short',
        messages: [],
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
        authorization: `Bearer ${config.previewToken}`,
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
        authorization: `Bearer ${config.previewToken}`,
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
  });
});
