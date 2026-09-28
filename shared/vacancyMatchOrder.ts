/**
 * Порядок подобранных вакансий. Раньше очередь сортировалась сводным баллом,
 * который сам себя выдумывал (PRB-016): веса 50/35/15 ничем не обоснованы, а
 * вакансия без требований получала 30 баллов из отсутствия данных. Сравнивается
 * только измеримое — совпадение с целевой ролью, признак смежной роли, доля
 * покрытых требований, география и свежесть записи.
 */

export type VacancyRoleMatch = 'target' | 'partial' | 'none';
export type VacancyLevelMatch = 'match' | 'below' | 'above' | 'unknown';

export interface VacancyRequirementCoverage {
  readonly matched: number;
  readonly total: number;
}

export interface OrderableMatch {
  readonly cluster: { readonly firstObservedAt?: string; readonly isRemote?: boolean };
  readonly explanation: {
    readonly roleMatch?: VacancyRoleMatch;
    readonly levelMatch?: VacancyLevelMatch;
    readonly requirements?: VacancyRequirementCoverage;
    readonly adjacentRole?: boolean;
    readonly outsideGeography?: boolean;
  };
}

const ROLE_RANK: Record<VacancyRoleMatch, number> = { target: 2, partial: 1, none: 0 };

function roleRank(match: OrderableMatch): number {
  return ROLE_RANK[match.explanation.roleMatch ?? 'none'];
}

function functionRank(match: OrderableMatch): number {
  const role = match.explanation.roleMatch ?? 'none';
  if (role === 'none') return 0;
  if (match.explanation.adjacentRole) return 1;
  return 2;
}

function levelRank(match: OrderableMatch): number {
  const level = match.explanation.levelMatch;
  if (level === undefined || level === 'match') return 1;
  return 0;
}

function geographyTier(match: OrderableMatch): number {
  if (match.cluster.isRemote) return 1;
  return match.explanation.outsideGeography ? 0 : 1;
}

function requirementStatus(match: OrderableMatch): number {
  const requirements = match.explanation.requirements;
  if (!requirements || requirements.total === 0) return 1;
  if (requirements.matched >= 1) return 2;
  return 0;
}

/**
 * Принадлежность к высшей квалифицированной ступени (B296):
 * целевая функция + совпавший уровень ('match') + допустимая география (удалёнка/местный офис).
 */
function isQualifiedTier(match: OrderableMatch): boolean {
  return (
    functionRank(match) === 2 &&
    match.explanation.levelMatch === 'match' &&
    geographyTier(match) === 1
  );
}

function geographyRank(match: OrderableMatch): number {
  if (match.cluster.isRemote) return 0;
  return match.explanation.outsideGeography ? 2 : 1;
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
  // 1. Целевая функция выше смежной (adjacent) и несовпавшей (none)
  const fnDiff = functionRank(right) - functionRank(left);
  if (fnDiff !== 0) return fnDiff;

  // 2. Внутри целевой функции:
  // Если обе записи принадлежат квалифицированной ступени (целевая функция + совпавший уровень + допустимая география):
  // вакансия с ≥ 1 совпадением (2) стоит выше n = 0 (1), а n = 0 выше 0/n (0).
  const leftQualified = isQualifiedTier(left);
  const rightQualified = isQualifiedTier(right);

  if (leftQualified && rightQualified) {
    const reqDiff = requirementStatus(right) - requirementStatus(left);
    if (reqDiff !== 0) return reqDiff;
    const roleDiff = roleRank(right) - roleRank(left);
    if (roleDiff !== 0) return roleDiff;
    const shareDiff = coverageShare(right) - coverageShare(left);
    if (shareDiff !== 0) return shareDiff;
    const matchDiff =
      (right.explanation.requirements?.matched ?? 0) -
      (left.explanation.requirements?.matched ?? 0);
    if (matchDiff !== 0) return matchDiff;
    const geoDiff = geographyRank(left) - geographyRank(right);
    if (geoDiff !== 0) return geoDiff;
    return observedAt(right) - observedAt(left);
  }

  // Если одна запись в квалифицированной ступени (с хотя бы n=0 или ≥1), а другая нет (дальний офис или несовпавший уровень):
  if (leftQualified !== rightQualified) {
    if (leftQualified && requirementStatus(left) >= 1) return -1;
    if (rightQualified && requirementStatus(right) >= 1) return 1;
  }

  // Общий порядок ранжирования для остальных случаев:
  const lvlDiff = levelRank(right) - levelRank(left);
  if (lvlDiff !== 0) return lvlDiff;

  const roleDiff = roleRank(right) - roleRank(left);
  if (roleDiff !== 0) return roleDiff;

  // Внутри сопоставимой роли: допустимая география выше дальних офисов
  const geoTierDiff = geographyTier(right) - geographyTier(left);
  if (geoTierDiff !== 0) return geoTierDiff;

  const reqDiff = requirementStatus(right) - requirementStatus(left);
  if (reqDiff !== 0) return reqDiff;

  const shareDiff = coverageShare(right) - coverageShare(left);
  if (shareDiff !== 0) return shareDiff;

  const matchDiff =
    (right.explanation.requirements?.matched ?? 0) -
    (left.explanation.requirements?.matched ?? 0);
  if (matchDiff !== 0) return matchDiff;

  const geoDiff = geographyRank(left) - geographyRank(right);
  if (geoDiff !== 0) return geoDiff;

  return observedAt(right) - observedAt(left);
}
