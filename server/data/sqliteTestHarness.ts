import { rmSync } from 'node:fs';
import { afterEach } from 'vitest';
import type { CoachProviderResult } from '../providers/coachProvider';
import { SqliteCandidateStore } from './sqliteCandidateStore';

export const stores: SqliteCandidateStore[] = [];
export const directories: string[] = [];

afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) =>
    rmSync(directory, { recursive: true, force: true }),
  );
});

export function createStore(databasePath = ':memory:') {
  const store = new SqliteCandidateStore({
    databasePath,
    encryptionKey: Buffer.alloc(32, 4),
  });
  stores.push(store);
  return store;
}

export function createCandidate(store: SqliteCandidateStore) {
  return store.createCandidate({
    dataClass: 'synthetic',
    locale: 'ru-RU',
  });
}

export const output: CoachProviderResult = {
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
    careerTrack: null,
    actionProposals: [],
  },
};

export const turnRequest = {
  messageId: '85512ddf-962c-4a7c-a4cc-30a35d1e5847',
  content: 'Я запускал продукт.',
  phase: 'discovery' as const,
};

