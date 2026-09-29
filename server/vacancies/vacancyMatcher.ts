import type { VacancyCluster, VacancyMatchExplanation } from '../domain/unifiedVacancy';
import type { VacancyRoleMatch } from '../../shared/vacancyMatchOrder';
import type { FunctionCode } from '../../shared/roleTaxonomy';
import { normalizeTextForComparison } from './vacancyFingerprint';
import { evaluateLevelMatch, LEVEL_RANK, type SeniorityLevel } from './levelMatcher';
import { rulesParse } from './titleParse/rulesParse';
import { canonicalizeSkill } from '../connectors/managementSkillsDictionary';

/**
 * Объяснение соответствия состоит только из измеримого. Сводный балл убран
 * (PRB-016): его веса 50/35/15 ничем не обоснованы, а вакансия без
 * перечисленных требований получала 30 баллов из отсутствия данных.
 */

export interface CandidateMatchProfile {
  candidateId: string;
  targetRoles: string[];
  confirmedSkills: string[];
  confirmedFacts: string[];
  preferredRemote?: boolean;
  preferredLocations?: string[];
  /** Целевой уровень роли кандидата — вход fit-dot «уровень» (B248). */
  targetLevel?: SeniorityLevel;
  /**
   * Подтверждённые навыки с id факта профиля, откуда они взяты (B248,
   * «совпадает по фактам профиля»). Необязателен: без него совпадение
   * остаётся строкой, как раньше.
   */
  confirmedSkillFacts?: readonly { readonly id: string; readonly label: string }[];
  /**
   * Коды функций из ролей кампании (B267 S3): их наличие переключает
   * `roleMatch` на разбор названия вакансии вместо сравнения строк. Пусто —
   * подбор для этого кандидата остаётся на legacy-сравнении (например, ни
   * одна роль не свелась к известной функции).
   */
  semanticRoleFunctions?: readonly FunctionCode[];
}

interface MatchingFactPoint {
  readonly text: string;
  readonly factId?: string;
}

const PRODUCT_ADJACENT_CAMPAIGN_FUNCTIONS: readonly FunctionCode[] = [
  'eng',
  'eng-mgmt',
  'it-ops',
  'ops',
];

function evaluateSkills(
  candidateSkills: string[],
  vacancySkills: string[],
  confirmedSkillFacts: readonly { readonly id: string; readonly label: string }[] = [],
) {
  const matchingPoints: string[] = [];
  const matchingFacts: MatchingFactPoint[] = [];
  const missingPoints: string[] = [];
  const candidateSkillsNorm = new Set<string>();
  for (const skill of candidateSkills) {
    candidateSkillsNorm.add(normalizeTextForComparison(skill));
    candidateSkillsNorm.add(normalizeTextForComparison(canonicalizeSkill(skill)));
    // «Artificial Intelligence (AI)» из LinkedIn совпадает с «AI» вакансии.
    const abbreviation = /\(([^()]+)\)\s*$/u.exec(skill)?.[1];
    if (abbreviation) candidateSkillsNorm.add(normalizeTextForComparison(abbreviation));
  }

  const factIdByLabel = new Map<string, string>();
  for (const fact of confirmedSkillFacts) {
    const rawNorm = normalizeTextForComparison(fact.label);
    const canonNorm = normalizeTextForComparison(canonicalizeSkill(fact.label));
    factIdByLabel.set(rawNorm, fact.id);
    factIdByLabel.set(canonNorm, fact.id);
  }

  let matchedCount = 0;
  for (const skill of vacancySkills) {
    const skillNorm = normalizeTextForComparison(skill);
    const canonNorm = normalizeTextForComparison(canonicalizeSkill(skill));
    if (candidateSkillsNorm.has(skillNorm) || candidateSkillsNorm.has(canonNorm)) {
      matchedCount += 1;
      const text = `Подтверждённый навык: ${skill}`;
      matchingPoints.push(text);
      const factId = factIdByLabel.get(skillNorm) ?? factIdByLabel.get(canonNorm);
      matchingFacts.push(factId ? { text, factId } : { text });
    } else {
      missingPoints.push(skill);
    }
  }

  return { matchedCount, matchingPoints, matchingFacts, missingPoints };
}

function evaluateRole(targetRoles: string[], vacancyTitle: string) {
  let roleMatch: VacancyRoleMatch = 'none';
  const matchingPoints: string[] = [];
  const vacTitleNorm = normalizeTextForComparison(vacancyTitle);

  for (const targetRole of targetRoles) {
    const roleNorm = normalizeTextForComparison(targetRole);
    if (vacTitleNorm.includes(roleNorm) || roleNorm.includes(vacTitleNorm)) {
      roleMatch = 'target';
      matchingPoints.push(`Целевая роль: ${targetRole}`);
      break;
    }
    const overlap = roleNorm.split(' ').filter((w) => vacTitleNorm.includes(w)).length;
    if (overlap >= 2) {
      roleMatch = 'partial';
      matchingPoints.push(`Частичное совпадение по роли: ${targetRole}`);
    }
  }
  return { roleMatch, matchingPoints, adjacentRole: false };
}

/**
 * Смысловая оценка (B267 S3): функция вакансии — из разбора названия
 * правилами, а не из подстроки. Единственное смежное исключение — продуктовые
 * роли для Eng/Ops кампаний; остальные несовпадения остаются `none`.
 */
function evaluateSemanticRole(
  roleFunctions: readonly FunctionCode[],
  targetLevel: SeniorityLevel | undefined,
  vacancyTitle: string,
) {
  const parsed = rulesParse(vacancyTitle);
  const matchingPoints: string[] = [];
  const titleWords = new Set(normalizeTextForComparison(vacancyTitle).split(/\s+/u));
  const containsOtherCommercialFunction = (['sales', 'marketing'] as const).some((code) =>
    !roleFunctions.includes(code) && (parsed.functions.includes(code) || titleWords.has(code)),
  );
  const primaryFunction = parsed.functions[0];
  const hasTargetFunction = parsed.functions.some((code) => roleFunctions.includes(code));
  const adjacentProductRole =
    PRODUCT_ADJACENT_CAMPAIGN_FUNCTIONS.some((code) => roleFunctions.includes(code)) &&
    parsed.functions.includes('product') &&
    (!primaryFunction || !roleFunctions.includes(primaryFunction));
  if (
    containsOtherCommercialFunction ||
    (!hasTargetFunction && !adjacentProductRole)
  ) {
    return { roleMatch: 'none' as VacancyRoleMatch, matchingPoints, adjacentRole: false };
  }

  const targetRank = targetLevel ? LEVEL_RANK[targetLevel] : undefined;
  // Semantic SQL already limits persisted title_parse.level_rank to the
  // candidate's level and its adjacent step. The rules parser can disagree
  // with a persisted/model parse, so it must not reject an SQL-selected item.
  const distance =
    targetRank !== undefined && parsed.levelRank !== null
      ? Math.abs(parsed.levelRank - targetRank)
      : undefined;
  const roleMatch: VacancyRoleMatch = adjacentProductRole
    ? 'partial'
    : distance === 0
      ? 'target'
      : 'partial';
  if (adjacentProductRole) {
    matchingPoints.push('Смежная продуктовая роль вне семейств кампании.');
  }
  if (!adjacentProductRole) {
    matchingPoints.push(
      roleMatch === 'target'
        ? 'Функция роли и уровень совпадают по разбору названия.'
        : targetRank === undefined
          ? 'Функция роли совпадает; уровень кандидата неизвестен.'
          : 'Функция роли совпадает; уровень отобран семантическим фильтром.',
    );
  }
  return { roleMatch, matchingPoints, adjacentRole: adjacentProductRole };
}

const ROLE_SENTENCE: Record<VacancyRoleMatch, string> = {
  target: 'Название совпадает с целевой ролью.',
  partial: 'Название частично совпадает с целевой ролью.',
  none: 'Название не совпадает с целевыми ролями.',
};

/** Сводка называет то, что проверяемо: покрытие требований и совпадение роли. */
function summarize(
  roleMatch: VacancyRoleMatch,
  requirements: { matched: number; total: number } | undefined,
  adjacentRole = false,
): string {
  const coverage = requirements
    ? `Совпало ${requirements.matched} из ${requirements.total} требований вакансии.`
    : 'Вакансия не перечислила требований — сравнивать не с чем.';
  const roleSentence = adjacentRole
    ? 'Название относится к смежной продуктовой роли вне целевых семейств кампании.'
    : ROLE_SENTENCE[roleMatch];
  return `${coverage} ${roleSentence}`;
}

export function matchCandidateWithVacancy(
  candidate: CandidateMatchProfile,
  vacancy: VacancyCluster,
): VacancyMatchExplanation {
  const vacancySkills = vacancy.skills ?? [];
  const skillEval = evaluateSkills(
    candidate.confirmedSkills,
    vacancySkills,
    candidate.confirmedSkillFacts,
  );
  const roleEval = candidate.semanticRoleFunctions?.length
    ? evaluateSemanticRole(candidate.semanticRoleFunctions, candidate.targetLevel, vacancy.canonicalTitle)
    : evaluateRole(candidate.targetRoles, vacancy.canonicalTitle);
  const levelMatch = evaluateLevelMatch(candidate.targetLevel, vacancy.canonicalTitle);

  const locationPoints: string[] = [];
  if (candidate.preferredRemote && vacancy.isRemote) {
    locationPoints.push('Формат: Удалённая работа соответствует пожеланиям');
  }

  const requirements =
    vacancySkills.length > 0
      ? { matched: skillEval.matchedCount, total: vacancySkills.length }
      : undefined;

  return {
    clusterId: vacancy.id,
    roleMatch: roleEval.roleMatch,
    ...(roleEval.adjacentRole ? { adjacentRole: true } : {}),
    levelMatch,
    ...(requirements ? { requirements } : {}),
    matchingPoints: [...roleEval.matchingPoints, ...skillEval.matchingPoints, ...locationPoints],
    matchingFacts: [
      ...roleEval.matchingPoints.map((text) => ({ text })),
      ...skillEval.matchingFacts,
      ...locationPoints.map((text) => ({ text })),
    ],
    missingPoints: skillEval.missingPoints,
    summary: summarize(roleEval.roleMatch, requirements, roleEval.adjacentRole),
    calculatedAt: new Date().toISOString(),
  };
}
