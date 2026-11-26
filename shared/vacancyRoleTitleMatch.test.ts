import { describe, expect, it } from 'vitest';
import { titleMatchesRole } from './vacancyRoleTitleMatch';

describe('titleMatchesRole (B248)', () => {
  it('matches when the title contains the whole role phrase', () => {
    expect(titleMatchesRole('VP Technology Ops, EMEA', 'VP Technology Ops')).toBe(true);
  });

  it('matches when the role contains the whole title', () => {
    expect(titleMatchesRole('Chief Operating Officer', 'Chief Operating Officer, Global')).toBe(
      true,
    );
  });

  it('matches on at least two shared words without an exact substring', () => {
    expect(
      titleMatchesRole('Chief Operating Officer, VP Technology Ops', 'VP Technology Ops'),
    ).toBe(true);
  });

  it('does not match on a single shared word', () => {
    expect(titleMatchesRole('Technology Recruiter', 'VP Technology Ops')).toBe(false);
  });

  it('is case- and punctuation-insensitive', () => {
    expect(titleMatchesRole('vp technology-ops', 'VP TECHNOLOGY OPS')).toBe(true);
  });

  it('returns false for a blank role instead of matching everything', () => {
    expect(titleMatchesRole('VP Technology Ops', '   ')).toBe(false);
  });

  it('B766: роль совпадает только целыми словами — «CTO» не внутри «Director»', () => {
    expect(titleMatchesRole('Director of Customer Success', 'CTO')).toBe(false);
    expect(titleMatchesRole('Director, Pharmacovigilance Operations', 'CTO')).toBe(false);
    for (const title of [
      'Director of Field Operations',
      'Field Operations Director',
      'Director, Field Operations (EMEA)',
      'VP Field Operations',
    ]) {
      expect(titleMatchesRole(title, 'CTO')).toBe(false);
      expect(titleMatchesRole(title, 'Chief Technology Officer')).toBe(false);
    }
    expect(titleMatchesRole('Технический директор / Tech lead / CTO', 'CTO')).toBe(true);
    expect(titleMatchesRole('CTO', 'Chief Technology Officer CTO')).toBe(true);
    // Два общих слова — тоже целые слова: «ops» не находится в «Operations».
    expect(titleMatchesRole('Head of Development Operations', 'VP Development Ops')).toBe(false);
    expect(titleMatchesRole('Head of IT', 'Head of IT Operations')).toBe(true);
  });

  it('B766: слова должности роль не сводят — CTO, COO, CCO, CISO и CFO разные', () => {
    for (const title of [
      'Chief Operating Officer',
      'Landscaping Chief Operating Officer',
      'Chief Customer Officer',
      'Chief Client Officer',
      'Chief Information Security Officer',
      'Chief Financial Officer',
    ])
      expect(titleMatchesRole(title, 'Chief Technology Officer')).toBe(false);
    expect(titleMatchesRole('Head of Sales', 'Head of Engineering')).toBe(false);
    expect(titleMatchesRole('Директор по продажам', 'Директор по ИТ')).toBe(false);
  });

  it('B766: общая функция роль по-прежнему сводит', () => {
    for (const title of [
      'Chief Product & Technology Officer',
      'Group Chief Technology Officer, EMEA',
      'Chief Information & Technology Officer',
      'Chief Technical Officer And Head Of Operations',
    ])
      expect(titleMatchesRole(title, 'Chief Technology Officer')).toBe(true);
    expect(titleMatchesRole('Head of Artificial Intelligence', 'Head of AI')).toBe(true);
    expect(titleMatchesRole('Head of Information Technology', 'Head of IT')).toBe(true);
    expect(titleMatchesRole('Vice President of Engineering', 'VP of Engineering')).toBe(true);
    expect(titleMatchesRole('Engineering Director', 'Director of Engineering')).toBe(true);
  });
});
