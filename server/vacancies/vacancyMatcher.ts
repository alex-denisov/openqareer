import type { VacancyCluster, VacancyMatchExplanation } from '../domain/unifiedVacancy';
import { normalizeTextForComparison } from './vacancyFingerprint';

export interface CandidateMatchProfile {
  candidateId: string;
  targetRoles: string[];
  confirmedSkills: string[];
  confirmedFacts: string[];
  preferredRemote?: boolean;
  preferredLocations?: string[];
}

function evaluateSkills(candidateSkills: string[], vacancySkills: string[]) {
  const matchingPoints: string[] = [];
  const missingPoints: string[] = [];
  const candidateSkillsNorm = new Set(candidateSkills.map(normalizeTextForComparison));

  let matchedCount = 0;
  for (const skill of vacancySkills) {
    if (candidateSkillsNorm.has(normalizeTextForComparison(skill))) {
      matchedCount += 1;
      matchingPoints.push(`Подтверждённый навык: ${skill}`);
    } else {
      missingPoints.push(skill);
    }
  }

  const score = vacancySkills.length > 0 ? Math.round((matchedCount / vacancySkills.length) * 50) : 30;
  return { score, matchingPoints, missingPoints };
}

function evaluateRole(targetRoles: string[], vacancyTitle: string) {
  let score = 0;
  const matchingPoints: string[] = [];
  const vacTitleNorm = normalizeTextForComparison(vacancyTitle);

  for (const targetRole of targetRoles) {
    const roleNorm = normalizeTextForComparison(targetRole);
    if (vacTitleNorm.includes(roleNorm) || roleNorm.includes(vacTitleNorm)) {
      score = 35;
      matchingPoints.push(`Целевая роль: ${targetRole}`);
      break;
    }
    const overlap = roleNorm.split(' ').filter((w) => vacTitleNorm.includes(w)).length;
    if (overlap >= 2) {
      score = Math.max(score, 20);
      matchingPoints.push(`Частичное совпадение по роли: ${targetRole}`);
    }
  }
  return { score, matchingPoints };
}

function evaluateFitSummary(totalScore: number, hasRoleMatch: boolean) {
  if (totalScore >= 75) {
    return {
      fitLevel: 'strong' as const,
      summary: `Сильное совпадение по целевой роли (${hasRoleMatch ? 'соответствует' : 'близка'}) и ключевому стеку. Профиль кандидата имеет необходимые доказательства.`,
    };
  }
  if (totalScore >= 55) {
    return {
      fitLevel: 'good' as const,
      summary: 'Хорошее совпадение. Требуются незначительные дополнения по отдельным навыкам.',
    };
  }
  if (totalScore >= 35) {
    return {
      fitLevel: 'potential' as const,
      summary: 'Потенциальное направление. Существенные пробелы в стеке или требованиях роли.',
    };
  }
  return {
    fitLevel: 'low' as const,
    summary: 'Низкое соответствие текущему подтверждённому профилю кандидата.',
  };
}

export function matchCandidateWithVacancy(
  candidate: CandidateMatchProfile,
  vacancy: VacancyCluster,
): VacancyMatchExplanation {
  const skillEval = evaluateSkills(candidate.confirmedSkills, vacancy.skills ?? []);
  const roleEval = evaluateRole(candidate.targetRoles, vacancy.canonicalTitle);

  let locationScore = 0;
  const locPoints: string[] = [];
  if (candidate.preferredRemote && vacancy.isRemote) {
    locationScore = 15;
    locPoints.push('Формат: Удалённая работа соответствует пожеланиям');
  } else if (!candidate.preferredRemote && !vacancy.isRemote) {
    locationScore = 10;
  }

  const totalScore = Math.min(100, Math.max(0, skillEval.score + roleEval.score + locationScore));
  const { fitLevel, summary } = evaluateFitSummary(totalScore, roleEval.score > 0);

  return {
    clusterId: vacancy.id,
    matchScore: totalScore,
    fitLevel,
    matchingPoints: [...roleEval.matchingPoints, ...skillEval.matchingPoints, ...locPoints],
    missingPoints: skillEval.missingPoints,
    summary,
    calculatedAt: new Date().toISOString(),
  };
}
