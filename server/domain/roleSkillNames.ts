import type { RoleSkillAssessmentRun } from './roleSkillAssessment';

/** Все названия навыков проверки — то, что уходит на перевод (B734). */
export function runSkillNames(run: RoleSkillAssessmentRun): string[] {
  return [...new Set([...run.skills.map((skill) => skill.name), ...run.cases.map((record) => record.assessmentCase.skillName)])];
}

/**
 * B734: проверка с русскими названиями навыков — в списке навыков, в кейсе и в тексте его
 * вопроса. Название без перевода остаётся прежним; идентификаторы навыков не меняются.
 */
export function withSkillNames(
  run: RoleSkillAssessmentRun,
  names: ReadonlyMap<string, string>,
): RoleSkillAssessmentRun {
  const rename = (name: string) => names.get(name) ?? name;
  return {
    ...run,
    skills: run.skills.map((skill) => ({ ...skill, name: rename(skill.name) })),
    cases: run.cases.map((record) => {
      const { skillName, prompt } = record.assessmentCase;
      const renamed = rename(skillName);
      return {
        ...record,
        assessmentCase: {
          ...record.assessmentCase,
          skillName: renamed,
          prompt: prompt.split(`«${skillName}»`).join(`«${renamed}»`),
        },
      };
    }),
  };
}
