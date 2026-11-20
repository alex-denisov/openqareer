import { describe, expect, it } from 'vitest';
import { extractSystemDesignSchema } from '../domain/systemDesignSchema';
import { createCandidate, createStore } from './sqliteTestHarness';

const SCHEMA = extractSystemDesignSchema('Клиент → шлюз API → PostgreSQL.')!;
const NOW = '2026-11-19T10:00:00.000Z';

describe('B647: исправленная схема System Design', () => {
  it('stores one sealed schema per candidate, session and question', () => {
    const store = createStore();
    const owner = createCandidate(store);
    const repo = store.interviewSimulatorRepo.designSchemas;
    const key = { candidateId: owner.id, sessionId: 's1', questionId: 'q1' };
    expect(repo.get(key)).toBeNull();
    expect(repo.set(key, SCHEMA, NOW)).toEqual(SCHEMA);
    expect(repo.get(key)).toEqual(SCHEMA);
    const renamed = { ...SCHEMA, nodes: SCHEMA.nodes.map((node) => ({ ...node, label: 'X' })) };
    repo.set(key, renamed, NOW);
    expect(repo.get(key)).toEqual(renamed);
    expect(repo.get({ ...key, questionId: 'q2' })).toBeNull();
    const other = createCandidate(store);
    expect(repo.get({ ...key, candidateId: other.id })).toBeNull();
  });
});
