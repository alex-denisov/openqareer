import { describe, expect, it } from 'vitest';
import { classifySalaryMarketTitle, postedSalaryGrade } from './salaryMarketClassification';

describe('canonical salary profession and posted grade evidence', () => {
  it('groups senior and junior aliases into one unambiguous B267 profession', () => {
    const senior = classifySalaryMarketTitle(
      'Senior Frontend Developer',
      'senior-frontend-developer',
    );
    const junior = classifySalaryMarketTitle(
      'Junior Frontend Developer',
      'junior-frontend-developer',
    );
    expect(senior.profession).toMatchObject({ kind: 'b267', roleId: 'eng.frontend.ic' });
    expect(junior.profession).toMatchObject({ kind: 'b267', roleId: 'eng.frontend.ic' });
    expect(junior.role).toBe(senior.role);
    expect(senior.grade).toEqual({ grade: 'senior', marker: 'Senior' });
    expect(junior.grade).toEqual({ grade: 'junior', marker: 'Junior' });
  });
  it('preserves a non-IT canonical profession when an explicit grade prefixes its canonical name', () => {
    const junior = classifySalaryMarketTitle('Junior Accountant', 'junior-accountant');
    const senior = classifySalaryMarketTitle('Senior Accountant', 'senior-accountant');
    expect(junior.profession).toMatchObject({ kind: 'b267', roleId: 'finance.accountant.ic' });
    expect(senior.role).toBe(junior.role);
    expect(junior.grade.grade).toBe('junior');
    expect(senior.grade.grade).toBe('senior');
  });
  it.each([
    'Lead Generation Specialist',
    'Middle East Sales Manager',
    'Seniority Analyst',
    'Account Executive',
    'Senior Director',
    'Junior / Senior Developer',
    'Middle School Teacher',
  ])('does not invent a posted grade for %s', (title) => {
    expect(postedSalaryGrade(title).grade).toBe('unknown');
  });
  it('reads grade from raw title parentheses and treats combined markers as uncertain', () => {
    expect(postedSalaryGrade('Frontend Developer (Senior)')).toEqual({
      grade: 'senior',
      marker: 'Senior',
    });
    expect(postedSalaryGrade('Senior Tech Lead')).toEqual({ grade: 'unknown', marker: null });
  });
  it('does not pool unrelated unknown titles or ambiguous generic aliases into one profession', () => {
    const first = classifySalaryMarketTitle('Cosmic Happiness Guru', 'specialist');
    const second = classifySalaryMarketTitle('Molecular Basket Weaver', 'specialist');
    expect(first.profession.kind).toBe('unclassified_title');
    expect(second.profession.kind).toBe('unclassified_title');
    expect(first.role).not.toBe(second.role);
    expect(classifySalaryMarketTitle('Программист', 'developer').profession.kind).toBe(
      'unclassified_title',
    );
  });
});
