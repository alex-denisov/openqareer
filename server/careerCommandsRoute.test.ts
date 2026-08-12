import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { SessionAuth } from './auth/authService';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { CoachProvider } from './providers/coachProvider';

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
const stores: SqliteCandidateStore[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  stores.splice(0).forEach((store) => store.close());
});

describe('career command API', () => {
  it('materializes only a saved proposal into an approval-gated command', async () => {
    const { app, authorization } = await createApp();
    const turnIdempotencyKey = randomUUID();
    const messageId = randomUUID();
    const turn = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { authorization, 'idempotency-key': turnIdempotencyKey },
      payload: { messageId, content: 'Подготовь отклик' },
    });
    expect(turn.statusCode).toBe(200);

    const commandId = randomUUID();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/career-commands',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': commandId,
      },
      payload: { turnIdempotencyKey, proposalIndex: 0 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      schemaVersion: 'career-command-v1',
      commandId,
      capability: 'application.submit',
      status: 'awaiting_approval',
      authorization: { approvalId: null },
      provenance: {
        strategyDecisionId: turnIdempotencyKey,
        evidenceRefs: [messageId],
        modelInvocationIds: ['response-1'],
      },
    });
  });
});

async function createApp() {
  const store = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: Buffer.alloc(32, 7),
  });
  const candidate = store.createCandidate({
    dataClass: 'synthetic',
    locale: 'ru-RU',
  });
  const app = await buildApp({
    config,
    coachProvider: provider,
    candidateStore: store,
    authService: noSessions,
    serveStatic: false,
  });
  apps.push(app);
  stores.push(store);
  return { app, authorization: `Bearer ${candidate.accessToken}` };
}

const provider: CoachProvider = {
  async createTurn(input) {
    return {
      provider: 'openai',
      model: 'gpt-5.6-sol',
      responseId: 'response-1',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      result: {
        message: 'Отклик подготовлен только как предложение.',
        phase: 'targeting',
        memoryCandidates: [],
        nextQuestion: 'Подтвердить текст?',
        completeness: { known: [], unknown: [] },
        safety: { needsHuman: false, reason: null },
        careerTrack: null,
        actionProposals: [
          {
            kind: 'application.submit',
            objective: 'Отправить проверенный отклик.',
            evidenceRefs: [input.messages.at(-1)!.id],
            acceptanceCriteria: ['Получен внешний receipt'],
            expectedSignal: 'Отклик принят площадкой.',
            measureAfter: '2026-08-19',
            risk: 'external_side_effect',
          },
        ],
      },
    };
  },
};

const noSessions: SessionAuth = {
  async register() { throw new Error('not used'); },
  async login() { return null; },
  authenticate() { return null; },
  logout() {},
};

const config: ServerConfig = {
  host: '127.0.0.1', port: 3210,
  previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
  dataEncryptionKey: Buffer.alloc(32, 7), databasePath: ':memory:',
  model: 'gpt-5.6-sol', staticRoot: '/tmp/not-used', release: 'test',
  logLevel: 'fatal', secureCookies: false,
  allowedOrigins: ['http://localhost:3000'], seedAccounts: [], oauthProviders: {},
};
