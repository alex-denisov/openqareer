import { describe, expect, it } from 'vitest';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from '../domain/resumeDraft';
import { createCandidate, createStore } from './sqliteTestHarness';

const MASK = 'Enterprise Energy IT Services';

function storeWithMaskedPlaces() {
  const store = createStore();
  const candidate = createCandidate(store);
  store.addManualExperienceFact(candidate.id, 'chrono-1', 'VP of Technology, Enterprise Energy IT Services');
  store.addManualExperienceFact(candidate.id, 'chrono-2', 'Head of IT, Enterprise Energy IT Services');
  store.addManualExperienceFact(candidate.id, 'chrono-3', 'Advisor, OptiLab AI');
  const draft: ResumeDraft = {
    ...EMPTY_RESUME_DRAFT,
    experience: [
      { id: 'w1', chronologyMemoryId: 'chrono-1', employer: MASK, current: false, bulletMemoryIds: [] },
      { id: 'w2', chronologyMemoryId: 'chrono-2', employer: MASK, current: false, bulletMemoryIds: [] },
      { id: 'w3', chronologyMemoryId: 'chrono-3', employer: 'OptiLab AI', current: true, bulletMemoryIds: [] },
    ],
  };
  store.saveResumeDraft(candidate.id, draft, []);
  return { store, candidateId: candidate.id };
}

const placesOf = (store: ReturnType<typeof createStore>, id: string) => store.getSnapshot(id).resume?.draft.experience ?? [];

describe('answerEmployerName: настоящее название вместо маски (B639)', () => {
  it('название становится подтверждённым фактом и стоит на всех позициях этого работодателя', () => {
    const { store, candidateId } = storeWithMaskedPlaces();
    const memory = store.answerEmployerName(candidateId, 'name-1', MASK, { name: 'Россети Цифра' });
    expect(memory).toMatchObject({ status: 'confirmed', domain: 'other', statement: `Компания «${MASK}» в профиле называется «Россети Цифра».` });
    const [w1, w2, w3] = placesOf(store, candidateId);
    expect(w1).toMatchObject({ employer: MASK, employerRealName: 'Россети Цифра', employerNameMemoryId: 'name-1' });
    expect(w2).toMatchObject({ employerRealName: 'Россети Цифра', employerNameMemoryId: 'name-1' });
    expect(w3?.employerRealName).toBeUndefined();
    expect(store.getSnapshot(candidateId).memory.some((item) => item.id === 'name-1')).toBe(true);
  });

  it('исправление заменяет прежний факт, а не добавляет второй', () => {
    const { store, candidateId } = storeWithMaskedPlaces();
    store.answerEmployerName(candidateId, 'name-1', MASK, { name: 'Россети' });
    store.answerEmployerName(candidateId, 'name-2', MASK, { name: 'Россети Цифра' });
    const ids = store.getSnapshot(candidateId).memory.map((item) => item.id);
    expect(ids).toContain('name-2');
    expect(ids).not.toContain('name-1');
    expect(placesOf(store, candidateId)[0]).toMatchObject({ employerRealName: 'Россети Цифра', employerNameMemoryId: 'name-2' });
  });

  it('«это настоящее название» снимает факт и вопрос', () => {
    const { store, candidateId } = storeWithMaskedPlaces();
    store.answerEmployerName(candidateId, 'name-1', MASK, { name: 'Россети Цифра' });
    expect(store.answerEmployerName(candidateId, 'name-2', MASK, { keepAsIs: true })).toBeNull();
    const [w1] = placesOf(store, candidateId);
    expect(w1).toMatchObject({ employer: MASK, employerMaskKept: true });
    expect(w1?.employerRealName).toBeUndefined();
    expect(store.getSnapshot(candidateId).memory.some((item) => item.id === 'name-1')).toBe(false);
  });

  it('работодателя нет в профиле: конфликт, ничего не пишется', () => {
    const { store, candidateId } = storeWithMaskedPlaces();
    expect(() => store.answerEmployerName(candidateId, 'name-1', 'Другая компания', { name: 'X' })).toThrow();
    expect(store.getSnapshot(candidateId).memory.some((item) => item.id === 'name-1')).toBe(false);
  });
});
