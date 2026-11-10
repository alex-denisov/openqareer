import type { ResumeExperienceInput } from '../domain/resumeDraft';
import type { StoredMemory } from './candidateStore';
import type { MemoryMethodDeps } from './sqliteCandidateStoreMemoryMethods';
import { SqliteManualExperienceFactRepository } from './sqliteManualExperienceFactRepository';
import { CandidateStoreConflictError } from './store/errors';

/** Ответ кандидата на вопрос о маске работодателя: настоящее название или «это и есть название». */
export type EmployerNameAnswer = { readonly name: string } | { readonly keepAsIs: true };

export function employerNameStatement(mask: string, name: string): string {
  return `Компания «${mask}» в профиле называется «${name}».`;
}

function sameEmployer(entry: ResumeExperienceInput, employer: string): boolean {
  return entry.employer?.trim() === employer;
}

function answered(entry: ResumeExperienceInput, answer: EmployerNameAnswer, memoryId: string): ResumeExperienceInput {
  const { employerRealName: _name, employerNameMemoryId: _memory, employerMaskKept: _kept, ...rest } = entry;
  return 'name' in answer
    ? { ...rest, employerRealName: answer.name, employerNameMemoryId: memoryId }
    : { ...rest, employerMaskKept: true };
}

/**
 * B639: одно название на всех позициях одного работодателя. Новое название — новый подтверждённый факт,
 * прежний факт удаляется: так исправление не оставляет двух ответов, а отказ не оставляет ни одного.
 */
export function answerEmployerName(
  deps: MemoryMethodDeps,
  candidateId: string,
  memoryId: string,
  employer: string,
  answer: EmployerNameAnswer,
): StoredMemory | null {
  deps.requireCandidate(candidateId);
  return deps.transaction(() => {
    const snapshot = deps.getSnapshot(candidateId);
    const draft = snapshot.resume?.draft;
    const mask = employer.trim();
    const places = draft?.experience.filter((entry) => sameEmployer(entry, mask)) ?? [];
    if (!draft || places.length === 0) throw new CandidateStoreConflictError();
    const previous = new Set(places.flatMap((entry) => (entry.employerNameMemoryId ? [entry.employerNameMemoryId] : [])));
    const known = new Set(snapshot.memory.map((item) => item.id));
    const memory = 'name' in answer
      ? new SqliteManualExperienceFactRepository(deps.database, deps.sealedText)
        .add(candidateId, memoryId, employerNameStatement(mask, answer.name.trim()), 'other')
      : null;
    for (const id of previous) {
      if (id !== memoryId && known.has(id)) deps.conversations.changeMemory(candidateId, id, { action: 'delete' });
    }
    const experience = draft.experience.map((entry) => (sameEmployer(entry, mask) ? answered(entry, answer, memoryId) : entry));
    deps.saveResumeDraft(candidateId, { ...draft, experience }, snapshot.resume?.evidenceSnapshot ?? []);
    return memory;
  });
}
