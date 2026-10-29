import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { SessionAuth } from './auth/authService';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { CoachProvider } from './providers/coachProvider';

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
  async register() {
    throw new Error('registration unavailable in this test double');
  },
  async login() {
    return null;
  },
  isUsernameTaken() {
    return false;
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
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      result: {
        message: 'Проверим рынок.',
        phase: 'market',
        memoryCandidates: [],
        nextQuestion: null,
        completeness: { known: [], unknown: [] },
        safety: { needsHuman: false, reason: null },
        careerTrack: null,
        actionProposals: [],
      },
    };
  },
};

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const stores: SqliteCandidateStore[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  stores.splice(0).forEach((store) => store.close());
});

async function createApp(
  provider: CoachProvider,
  searchVacancies: NonNullable<
    Parameters<typeof buildApp>[0]['searchVacancies']
  >,
  extra: Pick<Parameters<typeof buildApp>[0], 'searchStoredVacancies' | 'logDestination'> = {},
) {
  const store = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = store.createCandidate({
    dataClass: 'synthetic',
    locale: 'ru-RU',
  });
  const app = await buildApp({
    // A test that reads the log needs its warnings; the others stay quiet.
    config: extra.logDestination ? { ...config, logLevel: 'info' } : config,
    coachProvider: provider,
    candidateStore: store,
    authService: noSessions,
    serveStatic: false,
    searchVacancies,
    ...extra,
  });
  apps.push(app);
  stores.push(store);
  return { app, authorization: `Bearer ${candidate.accessToken}` };
}

function sample(query: string) {
  return {
    source: 'hh' as const,
    query,
    found: 23,
    fetchedAt: '2026-08-12T12:00:00.000Z',
    items: [
      {
        id: '123',
        title: query,
        company: 'Synthetic Company',
        location: 'Москва',
        sourceUrl: 'https://hh.ru/vacancy/123',
        publishedAt: '2026-08-12T10:00:00+0300',
        salary: null,
        workMode: 'unknown' as const,
        requirements: [],
      },
    ],
  };
}

function requestHeaders(authorization: string, idempotencyKey = randomUUID()) {
  return {
    authorization,
    origin: 'http://localhost:3000',
    'idempotency-key': idempotencyKey,
  };
}

describe('career coach market observations', () => {
  it('adds a server-observed dated hh sample to a market turn', async () => {
    let observedInput: Parameters<CoachProvider['createTurn']>[0] | undefined;
    const provider: CoachProvider = {
      async createTurn(input) {
        observedInput = input;
        return successProvider.createTurn(input, randomUUID());
      },
    };
    const { app, authorization } = await createApp(provider, async () =>
      sample('руководитель продукта'),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: requestHeaders(authorization),
      payload: {
        messageId: randomUUID(),
        content: 'Проверь рынок вакансий для выбранной роли.',
        marketQuery: 'руководитель продукта',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(observedInput?.marketObservations).toEqual([
      expect.objectContaining({
        ref: 'market:hh:123',
        observedAt: '2026-08-12T12:00:00.000Z',
        sourceUrl: 'https://hh.ru/vacancy/123',
      }),
    ]);
  });

  it('answers from the stored hh crawl when the live sample is unavailable, and logs why', async () => {
    let observedInput: Parameters<CoachProvider['createTurn']>[0] | undefined;
    const provider: CoachProvider = {
      async createTurn(input) {
        observedInput = input;
        return successProvider.createTurn(input, randomUUID());
      },
    };
    const logs: Record<string, unknown>[] = [];
    const { app, authorization } = await createApp(
      provider,
      async () => {
        throw new Error('hh_vacancy_search_official_access_required');
      },
      {
        searchStoredVacancies: async (input) => ({
          ...sample(input.text),
          items: [{ ...sample(input.text).items[0], id: '456', sourceUrl: 'https://hh.ru/vacancy/456' }],
        }),
        logDestination: { write: (line) => logs.push(JSON.parse(line) as Record<string, unknown>) },
      },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: requestHeaders(authorization),
      payload: {
        messageId: randomUUID(),
        content: 'Проверь рынок вакансий для выбранной роли.',
        marketQuery: 'руководитель продукта',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(observedInput?.marketObservations).toEqual([
      expect.objectContaining({ ref: 'market:hh:456', sourceUrl: 'https://hh.ru/vacancy/456' }),
    ]);
    expect(logs).toContainEqual(
      expect.objectContaining({
        event: 'coach-market-live-sample-unavailable',
        reason: 'hh_vacancy_search_official_access_required',
      }),
    );
  });

  it('answers without market observations when no sample can be read', async () => {
    let observedInput: Parameters<CoachProvider['createTurn']>[0] | undefined;
    const provider: CoachProvider = {
      async createTurn(input) {
        observedInput = input;
        return successProvider.createTurn(input, randomUUID());
      },
    };
    const logs: Record<string, unknown>[] = [];
    const { app, authorization } = await createApp(
      provider,
      async () => {
        throw new Error('upstream payload must stay private');
      },
      {
        searchStoredVacancies: async () => {
          throw new Error('vacancy_match_timeout');
        },
        logDestination: { write: (line) => logs.push(JSON.parse(line) as Record<string, unknown>) },
      },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: requestHeaders(authorization),
      payload: {
        messageId: randomUUID(),
        content: 'Проверь рынок вакансий для выбранной роли.',
        marketQuery: 'руководитель продукта',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(observedInput?.marketObservations).toEqual([]);
    expect(logs).toContainEqual(
      expect.objectContaining({ event: 'coach-market-stored-sample-unavailable', reason: 'vacancy_match_timeout' }),
    );
  });

  it('rejects a changed market query under the same idempotency key', async () => {
    let providerCalls = 0;
    let searchCalls = 0;
    const provider: CoachProvider = {
      async createTurn(input, _key, options) {
        // The background analysis after the reply (28.10) is not a new generation.
        if (options?.split !== 'analysis') providerCalls += 1;
        return successProvider.createTurn(input, randomUUID());
      },
    };
    const { app, authorization } = await createApp(provider, async ({ text }) => {
      searchCalls += 1;
      return sample(text);
    });
    const idempotencyKey = randomUUID();
    const messageId = randomUUID();
    const request = (marketQuery: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/coach/turn',
        headers: requestHeaders(authorization, idempotencyKey),
        payload: {
          messageId,
          content: 'Проверь рынок вакансий для выбранной роли.',
          marketQuery,
        },
      });

    expect((await request('руководитель продукта')).statusCode).toBe(200);
    const conflict = await request('директор продукта');

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('candidate_state_conflict');
    expect(searchCalls).toBe(1);
    expect(providerCalls).toBe(1);
  });
});
