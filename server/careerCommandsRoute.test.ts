import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app';
import type { SessionAuth } from './auth/authService';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { CoachProvider } from './providers/coachProvider';
import type {
  ConnectorExecutor,
  ConnectorReceipt,
} from './connectors/connectorHarness';

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

  it('atomically approves a saved command into one durable outbox entry', async () => {
    const { app, authorization } = await createApp();
    const turnIdempotencyKey = randomUUID();
    const messageId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { authorization, 'idempotency-key': turnIdempotencyKey },
      payload: { messageId, content: 'Подготовь отклик' },
    });
    const commandId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/career-commands',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': commandId,
      },
      payload: { turnIdempotencyKey, proposalIndex: 0 },
    });

    const approvalId = randomUUID();
    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/career-commands/${commandId}/approvals`,
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': approvalId,
      },
    });
    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/career-commands/${commandId}/approvals`,
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': approvalId,
      },
    });

    expect(approved.statusCode).toBe(200);
    expect(approved.json().data).toMatchObject({
      commandId,
      status: 'queued',
      authorization: { approvalId },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data).toEqual(approved.json().data);
  });

  it('dispatches once and completes only from a matching connector receipt', async () => {
    const execute = vi.fn(
      async (request): Promise<ConnectorReceipt> => ({
        connectorId: 'synthetic-api',
        transport: 'official_api',
        action: request.action,
        status: 'completed',
        idempotencyKey: request.idempotencyKey,
        opportunityId: request.opportunityId,
        providerReference: 'synthetic-receipt-1',
        evidence: {
          kind: 'provider_receipt',
          observedAt: '2026-08-12T19:00:01.000Z',
        },
      }),
    );
    const executor: ConnectorExecutor = {
      connectorId: 'synthetic-api',
      transport: 'official_api',
      execute,
    };
    const { app, authorization } = await createApp(executor);
    const turnIdempotencyKey = randomUUID();
    const messageId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { authorization, 'idempotency-key': turnIdempotencyKey },
      payload: { messageId, content: 'Подготовь отклик' },
    });
    const commandId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/career-commands',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': commandId,
      },
      payload: { turnIdempotencyKey, proposalIndex: 0 },
    });
    const approvalId = randomUUID();
    const headers = {
      authorization,
      origin: 'http://localhost:3000',
      'idempotency-key': approvalId,
    };

    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/career-commands/${commandId}/approvals`,
      headers,
    });
    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/career-commands/${commandId}/approvals`,
      headers,
    });

    expect(approved.statusCode).toBe(200);
    expect(approved.json().data).toMatchObject({
      status: 'completed_with_receipt',
      execution: {
        status: 'completed_with_receipt',
        connector: {
          id: 'synthetic-api',
          providerReference: 'synthetic-receipt-1',
        },
      },
    });
    expect(replay.json().data).toEqual(approved.json().data);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('keeps commands tenant-scoped and fails closed on a mismatched receipt', async () => {
    const executor: ConnectorExecutor = {
      connectorId: 'synthetic-api',
      transport: 'official_api',
      async execute(request) {
        return {
          connectorId: 'synthetic-api',
          transport: 'official_api',
          action: request.action,
          status: 'completed',
          idempotencyKey: request.idempotencyKey,
          opportunityId: 'different-command-target',
          providerReference: 'must-not-be-accepted',
          evidence: {
            kind: 'provider_receipt',
            observedAt: '2026-08-12T19:00:01.000Z',
          },
        };
      },
    };
    const { app, authorization, store } = await createApp(executor);
    const turnIdempotencyKey = randomUUID();
    const messageId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { authorization, 'idempotency-key': turnIdempotencyKey },
      payload: { messageId, content: 'Подготовь отклик' },
    });
    const commandId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/career-commands',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': commandId,
      },
      payload: { turnIdempotencyKey, proposalIndex: 0 },
    });

    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/career-commands/${commandId}/approvals`,
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': randomUUID(),
      },
    });
    expect(approved.json().data).toMatchObject({
      status: 'paused',
      execution: {
        status: 'paused',
        diagnosticReason: 'receipt_invalid',
        connector: { providerReference: null },
      },
    });
    expect(JSON.stringify(approved.json())).not.toContain(
      'must-not-be-accepted',
    );

    const foreignCandidate = store.createCandidate({
      dataClass: 'synthetic',
      locale: 'ru-RU',
    });
    const foreignRead = await app.inject({
      method: 'GET',
      url: `/api/v1/candidate/career-commands/${commandId}`,
      headers: { authorization: `Bearer ${foreignCandidate.accessToken}` },
    });
    expect(foreignRead.statusCode).toBe(404);
    expect(foreignRead.json().error.code).toBe('career_command_not_found');
  });
});

async function createApp(careerCommandExecutor?: ConnectorExecutor) {
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
    careerCommandExecutor,
  });
  apps.push(app);
  stores.push(store);
  return { app, authorization: `Bearer ${candidate.accessToken}`, store };
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
