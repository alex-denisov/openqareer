import { createHash } from 'node:crypto';
import type { CandidateSnapshot, CandidateStore } from '../data/candidateStore';
import { isVacancyFitEvidence, type VacancyFitInput } from './vacancyFit';
import { vacancyFitEvidenceFacts } from './vacancyFitProfileEvidence';

type ProfileReader = Pick<CandidateStore, 'getSnapshot' | 'getCandidateWorkspace'>;

/**
 * Только то, что модель получает как доказательства (01.11): факты досье и разделы профиля из
 * vacancyFitEvidenceFacts, плюс город и условия кампании. Контакты, фото, гипотезы консультанта
 * процент не сбрасывают; правка «о себе» сбрасывает, потому что «о себе» теперь цитируется,
 * а прежний процент остаётся на экране как «пересчитывается».
 */
export function vacancyFitProfileStamp(snapshot: CandidateSnapshot, workspace: ReturnType<ProfileReader['getCandidateWorkspace']>): string {
  const evidence = vacancyFitEvidenceFacts(snapshot.candidate?.id ?? '', snapshot).map(({ candidateId: _candidate, ...fact }) => fact);
  const city = snapshot.resume?.draft?.candidate.contact?.location ?? null;
  const targetRole = snapshot.resume?.draft?.targetRole ?? null;
  return createHash('sha256').update(JSON.stringify(['b600', evidence, { city, targetRole }, conditionsOf(workspace, false)])).digest('hex');
}

/** Отпечаток B580-r с названиями ролей: по нему находится процент, посчитанный до 29.10. */
export function roleScopedVacancyFitProfileStamp(snapshot: CandidateSnapshot, workspace: ReturnType<ProfileReader['getCandidateWorkspace']>): string {
  return stampOf('b580-r', snapshot.memory.filter(isVacancyFitEvidence), snapshot, workspace, true);
}

/**
 * The B580 stamp hashed every memory row, so each hypothesis or open question of the consultant
 * reset all percents. Kept only to find results stored under it.
 */
export function previousVacancyFitProfileStamp(snapshot: CandidateSnapshot, workspace: ReturnType<ProfileReader['getCandidateWorkspace']>): string {
  return stampOf('b580', snapshot.memory, snapshot, workspace, true);
}

function stampOf(
  tag: string,
  memory: CandidateSnapshot['memory'],
  snapshot: CandidateSnapshot,
  workspace: ReturnType<ProfileReader['getCandidateWorkspace']>,
  withRoles: boolean,
): string {
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
  return createHash('sha256').update(JSON.stringify([tag, memory, compared, conditionsOf(workspace, withRoles)])).digest('hex');
}

function conditionsOf(workspace: ReturnType<ProfileReader['getCandidateWorkspace']>, withRoles: boolean) {
  const campaign = workspace?.campaign;
  return workspace
    ? {
        regions: workspace.regions,
        targetDirection: workspace.targetDirection,
        campaign: campaign
          // Названия ролей в новом отпечатке нет: роль сверяют ворота role и level, а переименование
          // ролей моделью пересчитывало все проценты (29.10: Киров 100 % → 25 %).
          ? withRoles
            ? { roles: campaign.roles, regions: campaign.regions, remoteOnly: campaign.remoteOnly ?? false, careerRoles: campaign.careerRoles ?? [] }
            : { regions: campaign.regions, remoteOnly: campaign.remoteOnly ?? false }
          : null,
      }
    : null;
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
      // Only what the percent cites: a hypothesis written while the model answered must not discard the paid result.
      if (JSON.stringify(vacancyFitEvidenceFacts(input.candidateId, current)) !== JSON.stringify(input.facts)) return false;
      return vacancyFitProfileStamp(current, store.getCandidateWorkspace(input.candidateId)) === input.profileContextHash;
    } catch { return false; }
  };
}
