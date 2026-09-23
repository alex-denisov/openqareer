import type { VacancyCluster, VacancyMatchExplanation } from '../domain/unifiedVacancy';
import type { VacancyRoleMatch } from '../../shared/vacancyMatchOrder';
import { normalizeTextForComparison } from './vacancyFingerprint';
import { evaluateLevelMatch, type SeniorityLevel } from './levelMatcher';

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
  const roleEval = evaluateRole(candidate.targetRoles, vacancy.canonicalTitle);
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
