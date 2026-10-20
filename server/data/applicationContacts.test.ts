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
    vacancy: { title: 'Head of Engineering', company: 'Вектор Банк', url: 'https://example.test/v', source: 'other' },
  });
  return { store, candidateId: candidate.id, applicationId: application.id };
}

describe('application contacts (B542)', () => {
  it('stores the contact name per application and clears it', () => {
    const { store, candidateId, applicationId } = storeWithApplication();
    expect(store.listApplicationContacts(candidateId).size).toBe(0);
    store.setApplicationContact(candidateId, applicationId, 'Мария Орлова');
    expect(store.listApplicationContacts(candidateId).get(applicationId)).toBe('Мария Орлова');
    store.setApplicationContact(candidateId, applicationId, null);
    expect(store.listApplicationContacts(candidateId).has(applicationId)).toBe(false);
  });

  it('refuses an application of another candidate', () => {
    const { store, applicationId } = storeWithApplication();
    const other = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    expect(() => store.setApplicationContact(other.id, applicationId, 'Мария Орлова')).toThrow();
  });
});
