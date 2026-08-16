import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoachProviderResult } from '../providers/coachProvider';
import { SqliteCandidateStore } from './sqliteCandidateStore';

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
  return store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
}

const turnRequest = {
  messageId: '85512ddf-962c-4a7c-a4cc-30a35d1e5847',
  content: 'Я запускал продукт.',
  phase: 'discovery' as const,
};

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
    nextQuestion: null,
    completeness: { known: [], unknown: [] },
    safety: { needsHuman: false, reason: null },
    careerTrack: null,
    actionProposals: [],
  },
};

describe('sealed resume drafts', () => {
  it('seals the resume draft per candidate and keeps it out of another cabinet', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-resume-'));
    directories.push(directory);
    const databasePath = join(directory, 'candidate.db');
    const store = createStore(databasePath);
    const candidateA = createCandidate(store);
    const candidateB = createCandidate(store);
    const turnId = '51df5f57-df61-4ac2-98af-202607310114';
    store.startTurn(candidateA.id, turnId, turnRequest);
    store.completeTurn(candidateA.id, turnId, output);
    const memory = store.getSnapshot(candidateA.id).memory[0]!;
    store.changeMemory(candidateA.id, memory.id, { action: 'confirm' });

    const draft = {
      candidate: {
        fullName: 'Синтетический Кандидат 731',
        contact: { email: 'synthetic731@example.test', links: [] },
      },
      targetRole: 'Operations Director',
      experience: [
        {
          id: 'current-role',
          chronologyMemoryId: memory.id,
          employer: 'Synthetic GmbH',
          current: true,
          bulletMemoryIds: [memory.id],
        },
      ],
      education: [],
      languages: [],
    };
    const snapshotEvidence = [
      {
        memoryId: memory.id,
        statement: memory.statement,
        sourceMessageIds: memory.sourceMessageIds,
      },
    ];

    const saved = store.saveResumeDraft(candidateA.id, draft, snapshotEvidence);
    expect(saved).toMatchObject({ draft, evidenceSnapshot: snapshotEvidence });
    expect(store.getSnapshot(candidateB.id).resume).toBeNull();

    const updated = store.saveResumeDraft(
      candidateA.id,
      { ...draft, targetRole: 'VP Operations' },
      snapshotEvidence,
    );
    expect(updated.draft.targetRole).toBe('VP Operations');
    expect(updated.createdAt).toBe(saved.createdAt);

    store.close();
    stores.splice(stores.indexOf(store), 1);
    const rawDatabase = readFileSync(databasePath).toString('utf8');
    expect(rawDatabase).not.toContain('Синтетический Кандидат 731');
    expect(rawDatabase).not.toContain('Synthetic GmbH');
    expect(rawDatabase).not.toContain('VP Operations');

    const reopened = createStore(databasePath);
    expect(reopened.getSnapshot(candidateA.id).resume?.draft.targetRole).toBe(
      'VP Operations',
    );

    expect(reopened.deleteCandidate(candidateA.id)).toBe(true);
    reopened.close();
    stores.splice(stores.indexOf(reopened), 1);
    const database = new DatabaseSync(databasePath, { readOnly: true });
    expect(
      database.prepare('SELECT COUNT(*) AS total FROM resume_drafts').get(),
    ).toEqual({ total: 0 });
    database.close();
  });
});
