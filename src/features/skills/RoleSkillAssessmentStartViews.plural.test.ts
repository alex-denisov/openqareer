import { describe, expect, it } from 'vitest';
import { repeatedRequirements, vacanciesGenitive } from './RoleSkillAssessmentStartViews';

describe('skill check copy counts', () => {
  it('declines repeated requirements by count', () => {
    expect(repeatedRequirements(1)).toBe('1 повторяющееся требование');
    expect(repeatedRequirements(3)).toBe('3 повторяющихся требования');
    expect(repeatedRequirements(11)).toBe('11 повторяющихся требований');
    expect(repeatedRequirements(21)).toBe('21 повторяющееся требование');
  });

  it('declines vacancies after «из»', () => {
    expect(vacanciesGenitive(1)).toBe('1 вакансии');
    expect(vacanciesGenitive(21)).toBe('21 вакансии');
    expect(vacanciesGenitive(5)).toBe('5 вакансий');
    expect(vacanciesGenitive(11)).toBe('11 вакансий');
  });
});
