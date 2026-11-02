import type { ProposedRole } from './roleProposals';

/**
 * На чём считается ATS-оценка, когда кандидат её не выбрал (открытие «Профиля»).
 * Правило одно для сервера и клиента: версия под вакансию, собранная из
 * нынешнего мастер-резюме, иначе роль из «Карьеры», иначе мастер без ключевых слов.
 */
export interface AtsRoleRequest {
  readonly title: string;
  readonly requirements: readonly string[];
}

export interface AtsRoleBasis {
  readonly request: AtsRoleRequest;
  readonly roleTitle: string;
}

/** Первая версия списка (новые сверху), собранная из текущей редакции мастер-резюме. */
export function currentMasterVersion<T extends { readonly sourceMasterRevision: string }>(
  versions: readonly T[],
  currentMasterRevision: string,
): T | null {
  return versions.find((version) => version.sourceMasterRevision === currentMasterRevision) ?? null;
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
