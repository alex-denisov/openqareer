import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoachProviderResult } from '../providers/coachProvider';
import {
  CandidateStoreConflictError,
  SqliteCandidateStore,
} from './sqliteCandidateStore';

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
});
