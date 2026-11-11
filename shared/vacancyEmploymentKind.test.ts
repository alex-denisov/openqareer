import { describe, expect, it } from 'vitest';
import { detectVacancyEmploymentKind as kind, employmentKindLabel } from './vacancyEmploymentKind';

describe('B646-7 employment kind', () => {
  it('recognises the four kinds in Russian and English', () => {
    expect(kind({ title: 'Backend Engineer', summary: 'Full-time, remote' })).toBe('full');
    expect(kind({ title: 'Бухгалтер', summary: 'Частичная занятость' })).toBe('part');
    expect(kind({ title: 'Designer (contract)' })).toBe('project');
    expect(kind({ title: 'Стажёр-аналитик', summary: 'полный день' })).toBe('internship');
    expect(kind({ title: 'Software Engineering Intern' })).toBe('internship');
  });

  it('returns nothing when the text does not say, so no chip is drawn', () => {
    expect(kind({ title: 'Product Manager', summary: 'Join our team' })).toBeUndefined();
    expect(employmentKindLabel(undefined)).toBeUndefined();
    expect(employmentKindLabel('project')).toBe('проект');
  });

  it('does not take «internal» or «international» for an internship', () => {
    expect(kind({ title: 'Internal Auditor', summary: 'international company' })).toBeUndefined();
  });
});
