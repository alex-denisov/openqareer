import { describe, expect, it } from 'vitest';
import { pluralRu } from './pluralRu';

const FORMS: [string, string, string] = ['вакансия', 'вакансии', 'вакансий'];

describe('pluralRu', () => {
  it('uses the singular form for 1, 21, 61', () => {
    expect(pluralRu(1, FORMS)).toBe('1 вакансия');
    expect(pluralRu(21, FORMS)).toBe('21 вакансия');
    expect(pluralRu(61, FORMS)).toBe('61 вакансия');
  });

  it('uses the few form for 2-4 and 22-24', () => {
    expect(pluralRu(2, FORMS)).toBe('2 вакансии');
    expect(pluralRu(4, FORMS)).toBe('4 вакансии');
    expect(pluralRu(22, FORMS)).toBe('22 вакансии');
  });

  it('uses the many form for 0, 5-20, 11-14, 25', () => {
    expect(pluralRu(0, FORMS)).toBe('0 вакансий');
    expect(pluralRu(5, FORMS)).toBe('5 вакансий');
    expect(pluralRu(11, FORMS)).toBe('11 вакансий');
    expect(pluralRu(14, FORMS)).toBe('14 вакансий');
    expect(pluralRu(25, FORMS)).toBe('25 вакансий');
  });
});
