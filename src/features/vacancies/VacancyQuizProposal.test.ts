import { describe, expect, it } from 'vitest';
import { focusCheckStartable, skillCheckAvailability } from './VacancyQuizProposal';
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

  it('names where the role is chosen and offers the way there (B510)', () => {
    const availability = skillCheckAvailability({ state: 'role_not_selected' });
    expect(availability).toMatchObject({ kind: 'unavailable', needsRole: true });
    expect(availability.kind === 'unavailable' && availability.reason).toContain('«Карьера»');
  });
});

describe('focusCheckStartable (B552)', () => {
  it('offers the vacancy quiz without a chosen «Стратегия»: it runs on the vacancy role', () => {
    expect(focusCheckStartable('role_not_selected')).toBe(true);
    expect(focusCheckStartable('ready')).toBe(true);
  });

  it('hides it only when the vacancy source cannot be read', () => {
    expect(focusCheckStartable('source_unavailable')).toBe(false);
  });
});
