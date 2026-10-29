import { describe, expect, it } from 'vitest';
import { assessmentKicker } from './roleSkillAssessmentState';

describe('assessmentKicker (B5)', () => {
  it('says «по роли» when opened from the profile', () => {
    expect(assessmentKicker({ fromCareer: false, fromVacancy: false })).toBe(
      'Профиль · проверка по роли',
    );
  });
  it('says «по вакансии» only when opened from a vacancy', () => {
    expect(assessmentKicker({ fromCareer: false, fromVacancy: true })).toBe(
      'Профиль · проверка по вакансии',
    );
  });
  it('keeps the career label', () => {
    expect(assessmentKicker({ fromCareer: true, fromVacancy: false })).toBe(
      'Карьера · проверка роли',
    );
  });
});
