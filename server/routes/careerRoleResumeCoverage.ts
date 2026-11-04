import type { ProposedRole } from '../../shared/roleProposals';
import { requirementsCoveredByResume } from '../domain/resumeAtsAssessment';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { buildResumeStudioProjection } from '../domain/resumeStudio';
import type { ResumeDocument } from '../domain/resumeStudioTypes';
import type { RouteDeps } from './deps';

/**
 * «В профиле не указано» на «Карьере» решает та же проверка, что и ATS: разделы
 * резюме и словарь, а не точное совпадение с фактами памяти. Иначе один профиль
 * давал два ответа (04.11: «Управление командой» было в опыте и в «Обо мне»).
 * Подбор рыночных ролей считается раньше и от этого не зависит.
 */
export function withResumeCoverage(
  roles: readonly ProposedRole[],
  document: ResumeDocument,
): ProposedRole[] {
  return roles.map((role) => {
    const { confirmation } = role;
    if (confirmation.state !== 'observed') return role;
    const covered = new Set([
      ...(confirmation.matchedRequirementNames ?? []),
      ...requirementsCoveredByResume(document, confirmation.repeatedRequirements),
    ]);
    return {
      ...role,
      confirmation: {
        ...confirmation,
        matchedRequirementNames: confirmation.repeatedRequirements.filter((req) =>
          covered.has(req),
        ),
      },
    };
  });
}

export function masterResumeDocument(
  deps: Pick<RouteDeps, 'candidateStore'>,
  candidateId: string,
): ResumeDocument {
  const snapshot = deps.candidateStore.getSnapshot(candidateId);
  const draft = snapshot.resume?.draft ?? EMPTY_RESUME_DRAFT;
  return buildResumeStudioProjection({ ...draft, evidence: snapshot.memory }).master;
}
