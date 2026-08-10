import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoachProviderResult } from '../providers/coachProvider';
import {
  CandidateStoreConflictError,
  SqliteCandidateStore,
} from './sqliteCandidateStore';
import { MIGRATION_1, MIGRATION_2 } from './sqliteSchema';
import {
  evaluateProductCase,
  evaluateWorkPreferences,
  type WorkPreferenceSubmission,
} from '../domain/assessment';
import { evaluateGermanyMarket } from '../domain/germanyMarket';

const stores: SqliteCandidateStore[] = [];
const directories: string[] = [];

afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) =>
    rmSync(directory, { recursive: true, force: true }),
  );
});

function createStore(databasePath = ':memory:') {
  const store = new SqliteCandidateStore({
    databasePath,
    encryptionKey: Buffer.alloc(32, 4),
  });
  stores.push(store);
  return store;
}

function createCandidate(store: SqliteCandidateStore) {
  return store.createCandidate({
    dataClass: 'synthetic',
    locale: 'ru-RU',
  });
}

const output: CoachProviderResult = {
  provider: 'openrouter',
  model: 'nemotron-test',
  responseId: 'response-1',
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
  result: {
    message: 'Уточним наблюдаемый результат.',
    phase: 'evidence',
    memoryCandidates: [
      {
        kind: 'fact',
        domain: 'responsibility',
        statement: 'Кандидат сообщил об опыте запуска продукта.',
        confidence: 'candidate-reported',
        sourceMessageIds: ['85512ddf-962c-4a7c-a4cc-30a35d1e5847'],
        sensitive: false,
      },
    ],
    nextQuestion: 'Что изменилось после запуска?',
    completeness: {
      known: ['Есть опыт запуска'],
      unknown: ['Результат'],
    },
    safety: { needsHuman: false, reason: null },
  },
};

const turnRequest = {
  messageId: '85512ddf-962c-4a7c-a4cc-30a35d1e5847',
  content: 'Я запускал продукт.',
  phase: 'discovery' as const,
};

describe('SQLite candidate memory', () => {
  it('isolates candidate tokens, messages and memory', () => {
    const store = createStore();
    const candidateA = createCandidate(store);
    const candidateB = createCandidate(store);

    expect(store.authenticate(candidateA.accessToken)?.id).toBe(candidateA.id);
    expect(store.authenticate(candidateB.accessToken)?.id).toBe(candidateB.id);
    expect(store.authenticate('oqc_invalid')).toBeNull();

    const started = store.startTurn(
      candidateA.id,
      '51df5f57-df61-4ac2-98af-202607310101',
      turnRequest,
    );
    expect(started.state).toBe('ready');
    store.completeTurn(
      candidateA.id,
      '51df5f57-df61-4ac2-98af-202607310101',
      output,
    );

    expect(store.getSnapshot(candidateA.id).messages).toHaveLength(2);
    expect(store.getSnapshot(candidateA.id).memory).toHaveLength(1);
    expect(store.getSnapshot(candidateA.id).dossier.sections[0]).toMatchObject({
      domain: 'responsibility',
    });
    expect(store.getSnapshot(candidateB.id).messages).toEqual([]);
    expect(store.getSnapshot(candidateB.id).memory).toEqual([]);
    const memoryId = store.getSnapshot(candidateA.id).memory[0].id;
    expect(
      store.changeMemory(candidateB.id, memoryId, { action: 'confirm' }),
    ).toBeNull();
  });

  it('persists input before provider completion and retries idempotently', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    const idempotencyKey = '51df5f57-df61-4ac2-98af-202607310102';

    store.startTurn(candidate.id, idempotencyKey, turnRequest);
    store.failTurn(candidate.id, idempotencyKey, 'provider_timeout');
    expect(store.getSnapshot(candidate.id).messages).toEqual([
      {
        id: turnRequest.messageId,
        role: 'user',
        content: turnRequest.content,
      },
    ]);

    const retry = store.startTurn(candidate.id, idempotencyKey, turnRequest);
    expect(retry.state).toBe('ready');
    expect(store.getSnapshot(candidate.id).messages).toHaveLength(1);
    store.completeTurn(candidate.id, idempotencyKey, output);

    const cached = store.startTurn(candidate.id, idempotencyKey, turnRequest);
    expect(cached).toMatchObject({
      state: 'completed',
      output: {
        provider: 'openrouter',
        responseId: 'response-1',
      },
    });
    expect(store.getSnapshot(candidate.id).messages).toHaveLength(2);
    expect(() =>
      store.startTurn(candidate.id, idempotencyKey, {
        ...turnRequest,
        content: 'Другой ввод под тем же ключом.',
      }),
    ).toThrow(CandidateStoreConflictError);
  });

  it('keeps memory changes explicit and supports candidate deletion', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    const idempotencyKey = '51df5f57-df61-4ac2-98af-202607310103';
    store.startTurn(candidate.id, idempotencyKey, turnRequest);
    store.completeTurn(candidate.id, idempotencyKey, output);
    const memory = store.getSnapshot(candidate.id).memory[0];

    expect(
      store.changeMemory(candidate.id, memory.id, { action: 'confirm' }),
    ).toMatchObject({ status: 'confirmed' });
    expect(
      store.changeMemory(candidate.id, memory.id, {
        action: 'correct',
        statement: 'Кандидат подтвердил запуск B2B-продукта.',
      }),
    ).toMatchObject({
      status: 'corrected',
      statement: 'Кандидат подтвердил запуск B2B-продукта.',
    });
    expect(
      store.changeMemory(candidate.id, memory.id, { action: 'delete' }),
    ).toBeNull();
    expect(store.exportCandidate(candidate.id).memory).toEqual([]);

    expect(store.deleteCandidate(candidate.id)).toBe(true);
    expect(store.authenticate(candidate.accessToken)).toBeNull();
  });

  it('does not persist candidate plaintext in the database file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-store-'));
    directories.push(directory);
    const databasePath = join(directory, 'candidate.db');
    const store = createStore(databasePath);
    const candidate = createCandidate(store);
    store.startTurn(
      candidate.id,
      '51df5f57-df61-4ac2-98af-202607310104',
      {
        ...turnRequest,
        content: 'Уникальный секретный карьерный факт 731.',
      },
    );
    store.close();
    stores.splice(stores.indexOf(store), 1);

    expect(readFileSync(databasePath).toString('utf8')).not.toContain(
      'Уникальный секретный карьерный факт 731.',
    );
  });

  it('persists encrypted candidate-scoped assessments and replaces one version', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-assessment-'));
    directories.push(directory);
    const databasePath = join(directory, 'candidate.db');
    const store = createStore(databasePath);
    const candidateA = createCandidate(store);
    const candidateB = createCandidate(store);
    const firstPreferences: WorkPreferenceSubmission = {
      ambiguity: 5,
      evidence: 5,
      collaboration: 4,
      persuasion: 2,
      planning: 3,
      detail: 2,
      leadership: 3,
      craft: 4,
    };
    const revisedPreferences = { ...firstPreferences, planning: 5 } as const;
    const productCase = {
      firstMove: 'segment-funnel-and-interviews',
      priorityRule: 'reversible-test-biggest-uncertainty',
      successMeasure: 'activation-by-segment-with-guardrail',
      rationale: 'Уникальное объяснение кейса 984.',
    } as const;

    store.saveAssessment(
      candidateA.id,
      'work-preferences-v1',
      firstPreferences,
      evaluateWorkPreferences(firstPreferences),
    );
    store.saveAssessment(
      candidateA.id,
      'work-preferences-v1',
      revisedPreferences,
      evaluateWorkPreferences(revisedPreferences),
    );
    store.saveAssessment(
      candidateA.id,
      'product-case-v1',
      productCase,
      evaluateProductCase(productCase),
    );

    expect(store.getSnapshot(candidateA.id).assessments).toHaveLength(2);
    expect(
      store.getSnapshot(candidateA.id).assessments[0].submission,
    ).toMatchObject({ planning: 5 });
    expect(store.getSnapshot(candidateB.id).assessments).toEqual([]);
    store.close();
    stores.splice(stores.indexOf(store), 1);
    expect(readFileSync(databasePath).toString('utf8')).not.toContain(
      productCase.rationale,
    );

    const reopened = createStore(databasePath);
    expect(reopened.getSnapshot(candidateA.id).assessments).toHaveLength(2);
    expect(reopened.exportCandidate(candidateA.id).assessments[1]).toMatchObject({
      assessmentId: 'product-case-v1',
      result: { kind: 'product-case' },
    });
    expect(reopened.deleteCandidate(candidateA.id)).toBe(true);
  });

  it('persists one encrypted Germany profile with isolation and replacement', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-market-'));
    directories.push(directory);
    const databasePath = join(directory, 'candidate.db');
    const store = createStore(databasePath);
    const candidateA = createCandidate(store);
    const candidateB = createCandidate(store);
    const submission = {
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
    } as const;
    store.saveGermanyMarket(
      candidateA.id,
      submission,
      evaluateGermanyMarket(submission, new Date('2026-08-01T00:00:00Z')),
    );
    store.saveGermanyMarket(
      candidateA.id,
      { ...submission, grossAnnualSalaryEur: 60_000 },
      evaluateGermanyMarket(
        { ...submission, grossAnnualSalaryEur: 60_000 },
        new Date('2026-08-01T00:00:00Z'),
      ),
    );
    expect(store.getSnapshot(candidateA.id).germanyMarket).toMatchObject({
      country: 'DE',
      submission: { grossAnnualSalaryEur: 60_000 },
      result: { recommendedRouteId: 'eu-blue-card' },
    });
    expect(store.getSnapshot(candidateB.id).germanyMarket).toBeNull();
    store.close();
    stores.splice(stores.indexOf(store), 1);
    expect(readFileSync(databasePath).toString('utf8')).not.toContain(
      'recommendedRouteId',
    );
    const reopened = createStore(databasePath);
    expect(reopened.getSnapshot(candidateA.id).germanyMarket?.country).toBe('DE');
    expect(reopened.deleteCandidate(candidateA.id)).toBe(true);
  });

  it('migrates an existing v2 database without losing candidate tables', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-migration-'));
    directories.push(directory);
    const databasePath = join(directory, 'candidate.db');
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(MIGRATION_1);
    legacy.exec(MIGRATION_2);
    legacy
      .prepare(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?), (?, ?)',
      )
      .run(
        1,
        '2026-07-30T00:00:00.000Z',
        2,
        '2026-07-31T00:00:00.000Z',
      );
    legacy.close();

    const store = createStore(databasePath);
    const candidate = createCandidate(store);

    expect(store.getSnapshot(candidate.id)).toMatchObject({
      memory: [],
      assessments: [],
      germanyMarket: null,
      dossier: {
        confirmedCount: 0,
        proposedCount: 0,
        readiness: { complete: false },
      },
    });
  });

  it('consumes an encrypted candidate OAuth authorization exactly once', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-oauth-state-'));
    directories.push(directory);
    const databasePath = join(directory, 'candidate.db');
    const store = createStore(databasePath);
    const candidate = createCandidate(store);
    const stateDigest = 'a'.repeat(64);
    const codeVerifier = 'synthetic-pkce-verifier-that-must-not-be-plaintext';

    store.createOAuthAuthorization(candidate.id, {
      platform: 'hh',
      stateDigest,
      codeVerifier,
      expiresAt: '2026-08-10T12:10:00.000Z',
    });

    expect(
      store.consumeOAuthAuthorization(
        'hh',
        stateDigest,
        '2026-08-10T12:05:00.000Z',
      ),
    ).toEqual({ candidateId: candidate.id, codeVerifier });
    expect(
      store.consumeOAuthAuthorization(
        'hh',
        stateDigest,
        '2026-08-10T12:05:01.000Z',
      ),
    ).toBeNull();

    store.close();
    stores.splice(stores.indexOf(store), 1);
    expect(readFileSync(databasePath).toString('utf8')).not.toContain(
      codeVerifier,
    );
  });

  it('persists an encrypted tenant-scoped OAuth connection outside candidate export', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-oauth-connection-'));
    directories.push(directory);
    const databasePath = join(directory, 'candidate.db');
    const store = createStore(databasePath);
    const candidateA = createCandidate(store);
    const candidateB = createCandidate(store);
    const connection = {
      platform: 'hh' as const,
      externalAccountId: 'synthetic-hh-account-731',
      scopes: ['profile_read', 'resume_read'],
      capabilities: ['profile_read', 'resume_read'] as const,
      accessToken: 'synthetic-access-token-731',
      refreshToken: 'synthetic-refresh-token-731',
      accessTokenExpiresAt: '2026-08-24T12:00:00.000Z',
      profile: {
        capturedAt: '2026-08-10T12:00:00.000Z',
        sourceUrl: 'https://hh.ru/resume/synthetic731',
        facts: [
          {
            kind: 'headline' as const,
            value: 'Synthetic Operations Lead 731',
            sourceLocator: 'hh:resume:synthetic731:title',
            confidence: 'official-api' as const,
          },
        ],
      },
    };

    store.saveOAuthConnection(candidateA.id, connection);

    expect(store.getOAuthConnection(candidateA.id, 'hh')).toMatchObject(
      connection,
    );
    expect(store.listOAuthConnections(candidateB.id)).toEqual([]);
    expect(store.exportCandidate(candidateA.id)).not.toHaveProperty(
      'oauthConnections',
    );
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const rawDatabase = readFileSync(databasePath).toString('utf8');
    expect(rawDatabase).not.toContain(connection.accessToken);
    expect(rawDatabase).not.toContain(connection.refreshToken);
    expect(rawDatabase).not.toContain(connection.profile.facts[0].value);
  });
});
