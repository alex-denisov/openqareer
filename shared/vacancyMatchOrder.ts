/**
 * Порядок подобранных вакансий. Раньше очередь сортировалась сводным баллом,
 * который сам себя выдумывал (PRB-016): веса 50/35/15 ничем не обоснованы, а
 * вакансия без требований получала 30 баллов из отсутствия данных. Сравнивается
 * только измеримое — совпадение с целевой ролью, доля покрытых требований и
 * свежесть записи.
 */

export type VacancyRoleMatch = 'target' | 'partial' | 'none';
export type VacancyLevelMatch = 'match' | 'below' | 'above' | 'unknown';

export interface VacancyRequirementCoverage {
  readonly matched: number;
  readonly total: number;
}

export interface OrderableMatch {
  readonly cluster: { readonly firstObservedAt?: string };
  readonly explanation: {
    readonly roleMatch?: VacancyRoleMatch;
    readonly requirements?: VacancyRequirementCoverage;
  };
}

const ROLE_RANK: Record<VacancyRoleMatch, number> = { target: 2, partial: 1, none: 0 };

function roleRank(match: OrderableMatch): number {
  return ROLE_RANK[match.explanation.roleMatch ?? 'none'];
}

/** Доля покрытых требований; `-1` — вакансия требований не перечислила. */
function coverageShare(match: OrderableMatch): number {
  const requirements = match.explanation.requirements;
  if (!requirements || requirements.total === 0) return -1;
  return requirements.matched / requirements.total;
}

function observedAt(match: OrderableMatch): number {
  const parsed = Date.parse(match.cluster.firstObservedAt ?? '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function compareMatchedVacancies(left: OrderableMatch, right: OrderableMatch): number {
  return (
    roleRank(right) - roleRank(left) ||
    coverageShare(right) - coverageShare(left) ||
    (right.explanation.requirements?.matched ?? 0) -
      (left.explanation.requirements?.matched ?? 0) ||
    observedAt(right) - observedAt(left)
  );
}
