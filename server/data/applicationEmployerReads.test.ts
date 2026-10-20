import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SqliteCandidateStore } from './sqliteCandidateStore';

function storeWithApplication() {
  const store = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: randomBytes(32),
  });
  const candidate = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const application = store.createApplication(candidate.id, {
    stage: 'applied',
    vacancy: { title: 'Head of Platform', company: 'Вектор Банк', url: 'https://example.test/v', source: 'other' },
  });
  return { store, candidateId: candidate.id, applicationId: application.id };
}

describe('employer read marks (B543)', () => {
  it('records the candidate mark with its time and clears it', () => {
    const { store, candidateId, applicationId } = storeWithApplication();
    expect(store.getEmployerRead(candidateId, applicationId)).toBeNull();
    const mark = store.markEmployerRead(candidateId, applicationId, {
      readAt: '2026-10-06T06:05:00.000Z',
      source: 'candidate',
    });
    expect(mark).toEqual({ readAt: '2026-10-06T06:05:00.000Z', source: 'candidate' });
    expect(store.getEmployerRead(candidateId, applicationId)).toEqual(mark);
    expect(store.clearEmployerRead(candidateId, applicationId)).toBe(true);
    expect(store.getEmployerRead(candidateId, applicationId)).toBeNull();
  });

  it('keeps the hh.ru time when the candidate marks later, and hh.ru replaces a manual mark', () => {
    const { store, candidateId, applicationId } = storeWithApplication();
    store.markEmployerRead(candidateId, applicationId, { readAt: '2026-10-05T10:00:00.000Z', source: 'candidate' });
    store.markEmployerRead(candidateId, applicationId, { readAt: '2026-10-06T06:05:00.000Z', source: 'hh' });
    const kept = store.markEmployerRead(candidateId, applicationId, {
      readAt: '2026-10-07T06:05:00.000Z',
      source: 'candidate',
    });
    expect(kept).toEqual({ readAt: '2026-10-06T06:05:00.000Z', source: 'hh' });
    expect(store.clearEmployerRead(candidateId, applicationId)).toBe(false);
    expect(store.getEmployerRead(candidateId, applicationId)?.source).toBe('hh');
  });

  it('refuses an application of another candidate', () => {
    const { store, applicationId } = storeWithApplication();
    const other = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    expect(() =>
      store.markEmployerRead(other.id, applicationId, { readAt: '2026-10-06T06:05:00.000Z', source: 'candidate' }),
    ).toThrow();
  });
});
