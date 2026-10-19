import type { ProposedRole } from '../../../shared/roleProposals';
import type { ResumeAtsAssessmentRequest } from './resumeVersionsApi';

export interface AtsRoleBasis {
  readonly request: ResumeAtsAssessmentRequest;
  readonly roleTitle: string;
}

/**
 * Макет 2 «ATS: нет избранных вакансий»: без версии под вакансию ключевые слова
 * берутся из требований, повторяющихся у вакансий роли из «Карьеры».
 */
export function roleAtsRequest(roles: readonly ProposedRole[]): AtsRoleBasis | null {
  for (const role of roles) {
    if (role.confirmation.state !== 'observed') continue;
    const requirements = role.confirmation.repeatedRequirements;
    if (!requirements.length) continue;
    return {
      request: { title: `По роли «${role.title}»`, requirements: [...requirements] },
      roleTitle: role.title,
    };
  }
  return null;
}

/** Текст макета 2 «ATS: нет избранных вакансий» — общий для 1440 и 390. */
export const ATS_ROLE_BASIS_NOTE =
  'Ключевые слова считаются по ролям из «Карьеры», а не по вакансиям. Оценка помечена «по роли» и точнее станет после добавления вакансий в избранное.';
