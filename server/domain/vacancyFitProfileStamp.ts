import { createHash } from 'node:crypto';
import type { CandidateSnapshot, CandidateStore } from '../data/candidateStore';
import type { VacancyFitInput } from './vacancyFit';

type ProfileReader = Pick<CandidateStore, 'getSnapshot' | 'getCandidateWorkspace'>;

/**
 * Только то, что процент сверяет с требованиями (B580): факты, должности,
 * опыт, навыки, языки, город и условия кампании. Правка «о себе», контактов,
 * фото или текста о ситуации процент не сбрасывает — модель не пересчитывает
 * 40 тысяч результатов из-за опечатки в «о себе».
 */
export function vacancyFitProfileStamp(snapshot: CandidateSnapshot, workspace: ReturnType<ProfileReader['getCandidateWorkspace']>): string {
  const draft = snapshot.resume?.draft;
  const compared = draft
    ? {
        headline: draft.candidate.headline ?? null,
        city: draft.candidate.contact?.location ?? null,
        targetRole: draft.targetRole ?? null,
        experience: draft.experience,
        skills: draft.skills ?? [],
        languages: draft.languages,
      }
    : null;
  const campaign = workspace?.campaign;
  const conditions = workspace
    ? {
        regions: workspace.regions,
        targetDirection: workspace.targetDirection,
        campaign: campaign
          ? { roles: campaign.roles, regions: campaign.regions, remoteOnly: campaign.remoteOnly ?? false, careerRoles: campaign.careerRoles ?? [] }
          : null,
      }
    : null;
  return createHash('sha256').update(JSON.stringify(['b580', snapshot.memory, compared, conditions])).digest('hex');
}

/** Отпечаток до B580: по нему находится процент, посчитанный до смены формулы. */
export function legacyVacancyFitProfileStamp(snapshot: CandidateSnapshot, workspace: ReturnType<ProfileReader['getCandidateWorkspace']>): string {
  // Отметки визита «Сегодня» меняются при каждом заходе и к соответствию не относятся.
  // Сортировка «Вакансий» (29.10) тоже: иначе каждый клик по заголовку пересчитывал бы все проценты.
  const stable = workspace ? { ...workspace, lastVisitedAt: undefined, previousVisitedAt: undefined, vacancySort: undefined } : workspace;
  return createHash('sha256').update(JSON.stringify([snapshot.memory, snapshot.resume?.draft ?? null, stable])).digest('hex');
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
