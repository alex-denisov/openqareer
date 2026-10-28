import type { ResumeSkillInput } from './resumeTypes';

/** One line on where a skill gets confirmed: the quiz flow, in its own button labels. */
export const SKILL_CONFIRMATION_HINT =
  'Навык подтверждается квизом: «Пройти квиз» → ответы → «Принять результат».';

function rank(skill: ResumeSkillInput): number {
  if (skill.status === 'подтверждён') return 0;
  if (skill.status === 'не подтверждён') return 1;
  return 2;
}

/** Confirmed first, then checked-but-failed, then the rest; the order within a group is kept. */
export function orderSkillsByVerification(skills: readonly ResumeSkillInput[]): ResumeSkillInput[] {
  return skills
    .map((skill, index) => ({ skill, index }))
    .sort((left, right) => rank(left.skill) - rank(right.skill) || left.index - right.index)
    .map(({ skill }) => skill);
}

export function confirmedSkillsLine(skills: readonly ResumeSkillInput[]): string {
  const confirmed = skills.filter((skill) => skill.status === 'подтверждён').length;
  return `Подтверждено ${confirmed} из ${skills.length}.`;
}
