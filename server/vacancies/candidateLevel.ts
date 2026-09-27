import type { ResumeExperienceInput } from '../domain/resumeDraft';
import { inferSeniorityLevel, type SeniorityLevel } from './levelMatcher';

/**
 * Уровень кандидата для fit-dot «уровень» (B248) выводится, а не спрашивается
 * отдельной анкетой — источники, которые кандидат уже назвал: роль кампании
 * (то, на что он сейчас ищет) и последняя должность профиля (то, кем он уже
 * был). Кампания важнее должности: кандидат мог целиться выше своей текущей
 * позиции, и подбор обязан мерить его заявленную цель, а не прошлое.
 */
export interface CandidateLevelInput {
  readonly targetRoles: readonly string[];
  readonly experience: readonly Pick<ResumeExperienceInput, 'title' | 'current' | 'endDate'>[];
  readonly campaignLevel?: SeniorityLevel;
}

/** Последняя должность — текущая (`current: true`), иначе первая в списке. */
function lastPositionTitle(
  experience: readonly Pick<ResumeExperienceInput, 'title' | 'current' | 'endDate'>[],
): string | undefined {
  const current = experience.find((entry) => entry.current);
  if (current?.title) return current.title;
  return experience[0]?.title;
}

export function deriveCandidateTargetLevel(input: CandidateLevelInput): SeniorityLevel | undefined {
  for (const role of input.targetRoles) {
    const level = inferSeniorityLevel(role);
    if (level) return level;
  }
  if (input.campaignLevel) return input.campaignLevel;
  const lastTitle = lastPositionTitle(input.experience);
  return lastTitle ? inferSeniorityLevel(lastTitle) : undefined;
}
