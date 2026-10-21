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
  it('leaves the skill coverage to the server once the role check is ready', () => {
    expect(skillCheckAvailability(ready(['Go']))).toEqual({ kind: 'available' });
  });

  it('says honestly when the role has too few vacancies', () => {
    const current = {
      state: 'too_few_vacancies',
      roleTitle: 'EM',
      sampleSize: 4,
      threshold: 20,
    } as const;
    expect(skillCheckAvailability(current).kind).toBe('unavailable');
  });
});
