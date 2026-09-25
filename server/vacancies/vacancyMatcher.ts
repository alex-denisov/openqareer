import type { VacancyCluster, VacancyMatchExplanation } from '../domain/unifiedVacancy';
import type { VacancyRoleMatch } from '../../shared/vacancyMatchOrder';
import type { FunctionCode } from '../../shared/roleTaxonomy';
import { normalizeTextForComparison } from './vacancyFingerprint';
import { evaluateLevelMatch, LEVEL_RANK, type SeniorityLevel } from './levelMatcher';
import { rulesParse } from './titleParse/rulesParse';

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

function evaluateSkills(
  candidateSkills: string[],
  vacancySkills: string[],
  confirmedSkillFacts: readonly { readonly id: string; readonly label: string }[] = [],
) {
  const matchingPoints: string[] = [];
  const matchingFacts: MatchingFactPoint[] = [];
  const missingPoints: string[] = [];
  const candidateSkillsNorm = new Set(candidateSkills.map(normalizeTextForComparison));
  const factIdByLabel = new Map(
    confirmedSkillFacts.map((fact) => [normalizeTextForComparison(fact.label), fact.id]),
  );

  let matchedCount = 0;
  for (const skill of vacancySkills) {
    const skillNorm = normalizeTextForComparison(skill);
    if (candidateSkillsNorm.has(skillNorm)) {
      matchedCount += 1;
      const text = `Подтверждённый навык: ${skill}`;
      matchingPoints.push(text);
      const factId = factIdByLabel.get(skillNorm);
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
  return { roleMatch, matchingPoints };
}

/**
 * Смысловая оценка (B267 S3): функция вакансии — из разбора названия
 * правилами, а не из подстроки. `none` не выходит из этой функции ложью —
 * SQL-подбор уже не приносит вакансию без совпавшей функции, здесь только
 * защита для прямого вызова (тесты, будущая переоценка снимка).
 */
function evaluateSemanticRole(
  roleFunctions: readonly FunctionCode[],
  targetLevel: SeniorityLevel | undefined,
  vacancyTitle: string,
) {
  const parsed = rulesParse(vacancyTitle);
  const matchingPoints: string[] = [];
  if (!parsed.functions.some((code) => roleFunctions.includes(code))) {
    return { roleMatch: 'none' as VacancyRoleMatch, matchingPoints };
  }

  const targetRank = targetLevel ? LEVEL_RANK[targetLevel] : undefined;
  let roleMatch: VacancyRoleMatch;
  if (targetRank === undefined || parsed.levelRank === null) {
    // Уровень одной из сторон неизвестен — известна только функция.
    roleMatch = 'partial';
  } else {
    const distance = Math.abs(parsed.levelRank - targetRank);
    roleMatch = distance === 0 ? 'target' : distance === 1 ? 'partial' : 'none';
  }
  if (roleMatch !== 'none') {
    matchingPoints.push(
      roleMatch === 'target'
        ? 'Функция и уровень роли совпадают.'
        : 'Функция роли совпадает, уровень — соседняя ступень.',
    );
  }
  return { roleMatch, matchingPoints };
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
): string {
  const coverage = requirements
    ? `Совпало ${requirements.matched} из ${requirements.total} требований вакансии.`
    : 'Вакансия не перечислила требований — сравнивать не с чем.';
  return `${coverage} ${ROLE_SENTENCE[roleMatch]}`;
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
    ...(levelMatch ? { levelMatch } : {}),
    ...(requirements ? { requirements } : {}),
    matchingPoints: [...roleEval.matchingPoints, ...skillEval.matchingPoints, ...locationPoints],
    matchingFacts: [
      ...roleEval.matchingPoints.map((text) => ({ text })),
      ...skillEval.matchingFacts,
      ...locationPoints.map((text) => ({ text })),
    ],
    missingPoints: skillEval.missingPoints,
    summary: summarize(roleEval.roleMatch, requirements),
    calculatedAt: new Date().toISOString(),
  };
}
