import { createHash } from 'node:crypto';
import type { CandidateSnapshot, CandidateStore } from '../data/candidateStore';
import type { VacancyFitInput } from './vacancyFit';

type ProfileReader = Pick<CandidateStore, 'getSnapshot' | 'getCandidateWorkspace'>;

export function vacancyFitProfileStamp(snapshot: CandidateSnapshot, workspace: ReturnType<ProfileReader['getCandidateWorkspace']>): string {
  return createHash('sha256').update(JSON.stringify([snapshot.memory, snapshot.resume?.draft ?? null, workspace])).digest('hex');
}

/** Includes eligibility, resume and workspace preferences; never persisted as a plain index. */
export function currentVacancyFitProfileStamp(store: ProfileReader, candidateId: string): string | null {
  try {
    const snapshot = store.getSnapshot(candidateId);
    if (snapshot.candidate?.id !== candidateId) return null;
    return vacancyFitProfileStamp(snapshot, store.getCandidateWorkspace(candidateId));
  } catch { return null; }
}

export function currentVacancyFitProfileValidator(store: ProfileReader) {
  return (input: VacancyFitInput): boolean => {
    if (!input.profileContextHash) return false;
    try {
      const current = store.getSnapshot(input.candidateId);
      if (current.candidate?.id !== input.candidateId) return false;
      const facts = current.memory.map((fact) => ({ ...fact, candidateId: input.candidateId }));
      if (JSON.stringify(facts) !== JSON.stringify(input.facts)) return false;
      return vacancyFitProfileStamp(current, store.getCandidateWorkspace(input.candidateId)) === input.profileContextHash;
    } catch { return false; }
  };
}
