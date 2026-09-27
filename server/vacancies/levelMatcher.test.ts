import { describe, expect, it } from 'vitest';
import { evaluateLevelMatch, inferSeniorityLevel } from './levelMatcher';

describe('inferSeniorityLevel', () => {
  it.each([
    ['Software Engineer', undefined],
    ['Senior Frontend Engineer', 'ic'],
    ['Ведущий разработчик', 'ic'],
    ['Lead Backend Developer', 'lead'],
    ['Team Lead, Platform', 'lead'],
    ['Тимлид разработки', 'lead'],
    ['Head of Engineering', 'head'],
    ['Руководитель отдела разработки', 'head'],
    ['Director, Site Reliability Engineering', 'head'],
    ['Director of Product Marketing', 'head'],
    ['Директор по разработке', 'head'],
    ['Директор департамента ИТ-инфраструктуры', 'head'],
    ['Senior Director, Product Management', 'vp'],
    ['Sr. Director, Technical Program Management', 'vp'],
    ['Senior Vice President, Product', 'vp'],
    ['Vice President, Product', 'vp'],
    ['VP of Engineering', 'vp'],
    ['SVP, Operations', 'vp'],
    ['Вице-президент по технологиям', 'vp'],
    ['Старший директор по разработке', 'vp'],
    ['Chief Product Officer', 'c-level'],
    ['Chief of Staff', 'c-level'],
    ['CTO', 'c-level'],
    ['CIO', 'c-level'],
    ['CISO', 'c-level'],
    ['Генеральный директор', 'c-level'],
    ['Технический директор', 'c-level'],
    ['Технический директор (CTO)', 'c-level'],
    ['Директор по продукту (CPO)', 'c-level'],
    ['Директор по информационной безопасности (CISO)', 'c-level'],
  ] as const)('classifies %s as %s', (title, expectedLevel) => {
    expect(inferSeniorityLevel(title)).toBe(expectedLevel);
  });

  it('reads IC from a plain engineer title', () => {
    expect(inferSeniorityLevel('Senior Frontend Engineer')).toBe('ic');
  });

  it('reads lead from a lead/tech lead title', () => {
    expect(inferSeniorityLevel('Lead Backend Developer')).toBe('lead');
    expect(inferSeniorityLevel('Тимлид разработки')).toBe('lead');
  });

  it('reads head from a head-of title', () => {
    expect(inferSeniorityLevel('Head of Engineering')).toBe('head');
    expect(inferSeniorityLevel('Руководитель отдела разработки')).toBe('head');
  });

  it('reads VP from a vice-president title', () => {
    expect(inferSeniorityLevel('VP of Engineering')).toBe('vp');
    expect(inferSeniorityLevel('Vice President, Product')).toBe('vp');
  });

  it('reads C-level from CTO/CPO/CEO titles', () => {
    expect(inferSeniorityLevel('CTO')).toBe('c-level');
    expect(inferSeniorityLevel('Chief Product Officer')).toBe('c-level');
  });

  it('returns undefined when the title gives no seniority signal', () => {
    expect(inferSeniorityLevel('Frontend Engineer')).toBeUndefined();
  });
});

describe('evaluateLevelMatch', () => {
  it('counts the same and adjacent steps as a level match', () => {
    expect(evaluateLevelMatch('head', 'Head of Engineering')).toBe('match');
    expect(evaluateLevelMatch('vp', 'CTO')).toBe('match');
    expect(evaluateLevelMatch('vp', 'Head of Engineering')).toBe('match');
  });

  it('reports when the vacancy is below or above the candidate target', () => {
    expect(evaluateLevelMatch('vp', 'Senior Frontend Engineer')).toBe('below');
    expect(evaluateLevelMatch('ic', 'VP of Engineering')).toBe('above');
  });

  it('uses a stored title parse when one is available', () => {
    expect(evaluateLevelMatch('ic', 'Engineer II', 3)).toBe('above');
    expect(evaluateLevelMatch('vp', 'CTO', null)).toBe('unknown');
  });

  it('is unknown when the candidate never named a target level', () => {
    expect(evaluateLevelMatch(undefined, 'Head of Engineering')).toBe('unknown');
  });

  it('is unknown when the vacancy title gives no seniority signal', () => {
    expect(evaluateLevelMatch('head', 'Frontend Engineer')).toBe('unknown');
  });
});
