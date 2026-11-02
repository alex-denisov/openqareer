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

/** Роли «Карьеры», подтверждённые пулом, в порядке экрана. */
export function observedCareerRoles(roles: readonly ProposedRole[]): ProposedRole[] {
  return roles.filter((role) => role.confirmation.state === 'observed');
}

/** Меньше трёх слов ATS не оценивает: короткий список добираем тегами роли. */
const MIN_ROLE_KEYWORDS = 3;

function vacancyCountLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} вакансий`;
  if (last === 1) return `${count} вакансия`;
  if (last >= 2 && last <= 4) return `${count} вакансии`;
  return `${count} вакансий`;
}

/**
 * Основа оценки по роли: ключевые слова из требований вакансий роли (10–15 штук),
 * а теги площадки — только добавка, когда требований извлечено мало.
 * Подпись называет выборку, чтобы цифра не выглядела рыночным анализом.
 */
export function roleKeywordBasis(
  role: ProposedRole,
  found: { readonly keywords: readonly string[]; readonly vacanciesCounted: number },
): AtsRoleBasis | null {
  const tags = role.confirmation.state === 'observed' ? role.confirmation.repeatedRequirements : [];
  const requirements = [...found.keywords];
  if (requirements.length < MIN_ROLE_KEYWORDS) {
    const seen = new Set(requirements.map((item) => item.toLowerCase()));
    for (const tag of tags) {
      if (!seen.has(tag.toLowerCase())) {
        seen.add(tag.toLowerCase());
        requirements.push(tag);
      }
    }
  }
  if (!requirements.length) return null;
  const sample = found.keywords.length > 0 ? `: ${vacancyCountLabel(found.vacanciesCounted)}` : '';
  return {
    request: { title: `По роли «${role.title}»${sample}`, requirements },
    roleTitle: role.title,
  };
}
