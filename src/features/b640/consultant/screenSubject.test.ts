import { describe, expect, it } from 'vitest';
import { subjectOfScreen } from './screenSubject';

describe('subjectOfScreen (B746): объект экрана для консультанта', () => {
  it('отклик и его шаги (i01, i04, o02) — отклик', () => {
    expect(subjectOfScreen({ responseId: '92c3032e-5b7a-4ca5-b54c-2c4bbfde7bf5' })).toEqual({
      kind: 'application',
      id: '92c3032e-5b7a-4ca5-b54c-2c4bbfde7bf5',
    });
  });

  it('письмо к вакансии без отклика — вакансия', () => {
    expect(subjectOfScreen({ responseId: 'cluster-src-hh-search:139704325' })).toEqual({
      kind: 'vacancy',
      id: 'cluster-src-hh-search:139704325',
    });
  });

  it('карточка вакансии — вакансия', () => {
    expect(subjectOfScreen({ vacancyId: 'cluster-src-hh-search:1' })).toEqual({
      kind: 'vacancy',
      id: 'cluster-src-hh-search:1',
    });
  });

  it('«ближайшее интервью» без id и экраны без объекта — без subject', () => {
    expect(subjectOfScreen({ responseId: 'next' })).toBeUndefined();
    expect(subjectOfScreen({})).toBeUndefined();
    expect(subjectOfScreen(null)).toBeUndefined();
  });

  it('карточка компании — компания по ключу адреса (B783)', () => {
    expect(subjectOfScreen({ companyId: 'интачгруп' })).toEqual({
      kind: 'company',
      id: 'интачгруп',
    });
  });
});
