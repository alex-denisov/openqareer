import { describe, expect, it } from 'vitest';
import { SqliteCandidateStore } from './sqliteCandidateStore';
import type { CareerStrategy } from '../../shared/careerStrategy';

function store(): SqliteCandidateStore {
  return new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: Buffer.alloc(32, 5),
  });
}

const strategy: CareerStrategy = {
  current: {
    version: 2,
    role: {
      title: 'Head of Product',
      origin: 'model',
      reason: 'вёл продукты девять лет',
      evidenceRefs: ['memory:1'],
      confirmation: { state: 'too-few', sampleSize: 3 },
    },
    constraints: { regions: ['eu'], note: 'без релокации' },
    reason: 'откликов много, разговоров нет',
    decidedAt: '2026-09-03T16:00:00.000Z',
    provenance: { namedBy: 'gemini:gemini-3.6-flash', language: 'en', poolSize: 534 },
  },
  history: [
    {
      version: 1,
      role: {
        title: 'Product Manager',
        origin: 'model',
        reason: 'вёл продукты',
        evidenceRefs: ['memory:1'],
        confirmation: { state: 'not-found', sampleSize: 0 },
      },
      constraints: { regions: ['eu'], note: null },
      reason: 'Первый выбор роли',
      decidedAt: '2026-09-01T10:00:00.000Z',
      provenance: { namedBy: 'gemini:gemini-3.6-flash', language: 'en', poolSize: 512 },
    },
  ],
};

describe('career strategy storage', () => {
  it('возвращает стратегию с историей ровно такой, какой её сохранили', () => {
    const candidateStore = store();
    const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });

    expect(candidateStore.getCareerStrategy(candidate.id)).toBeNull();

    candidateStore.saveCareerStrategy(candidate.id, strategy);

    expect(candidateStore.getCareerStrategy(candidate.id)).toEqual(strategy);
    candidateStore.close();
  });

  it('стратегия одного кандидата не читается под другим', () => {
    const candidateStore = store();
    const mine = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const other = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });

    candidateStore.saveCareerStrategy(mine.id, strategy);

    expect(candidateStore.getCareerStrategy(other.id)).toBeNull();
    candidateStore.close();
  });

  it('стратегия попадает в выгрузку кандидата вместе с историей', () => {
    const candidateStore = store();
    const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    candidateStore.saveCareerStrategy(candidate.id, strategy);

    // Решение о собственной роли — данные кандидата: он вправе их забрать.
    expect(candidateStore.exportCandidate(candidate.id).careerStrategy).toEqual(strategy);
    candidateStore.close();
  });
});
