import { describe, expect, it } from 'vitest';
import { skillCheckAvailability } from './VacancyQuizProposal';
import type { RoleSkillAssessmentCurrent } from '../skills/roleSkillAssessmentApi';

const ready = (names: readonly string[]) =>
  ({
    state: 'ready',
    roleTitle: 'Engineering Manager',
    skills: names.map((name) => ({ skillId: name, name })),
  }) as unknown as RoleSkillAssessmentCurrent;

describe('skillCheckAvailability', () => {
  it('offers «Начать» when the role check covers one of the skills', () => {
    expect(skillCheckAvailability(ready(['Apache Kafka']), ['Kafka'])).toEqual({
      kind: 'available',
    });
  });

  it('says honestly when the check has no cases for these skills', () => {
    expect(skillCheckAvailability(ready(['Go']), ['Kafka', 'Kubernetes'])).toEqual({
      kind: 'unavailable',
      reason: 'В проверке навыков роли «Engineering Manager» нет кейсов по Kafka и Kubernetes.',
    });
  });

  it('says honestly when the role has too few vacancies', () => {
    const current = {
      state: 'too_few_vacancies',
      roleTitle: 'EM',
      sampleSize: 4,
      threshold: 20,
    } as const;
    expect(skillCheckAvailability(current, ['Kafka']).kind).toBe('unavailable');
  });
});
