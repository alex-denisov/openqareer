import { describe, expect, it, vi } from 'vitest';

const parses = vi.hoisted(() => ({ count: 0 }));
vi.mock('../vacancies/titleParse/rulesParse', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../vacancies/titleParse/rulesParse')>();
  return {
    ...actual,
    rulesParse: (...args: Parameters<typeof actual.rulesParse>) => {
      parses.count += 1;
      return actual.rulesParse(...args);
    },
  };
});

const { exactRoleTest } = await import('./matchedFitRelevance');

const titles = [
  'CTO',
  'Технический директор (CTO)',
  'Head of IT',
  'Product Manager',
  'VP of Engineering',
];

describe('exactRoleTest: разбор названия — один на процесс, а не на каждый запрос (B770)', () => {
  it('второй запрос с другими ролями не разбирает те же названия заново', () => {
    const first = exactRoleTest(['CTO']);
    const firstAnswers = titles.map(first);
    const afterFirst = parses.count;

    const second = exactRoleTest(['Head of IT']);
    const secondAnswers = titles.map(second);

    // Только роль кандидата нового запроса (словарь и ключ роли); названия вакансий уже разобраны.
    expect(parses.count - afterFirst).toBeLessThanOrEqual(2);
    expect(afterFirst).toBeGreaterThanOrEqual(titles.length);
    expect(firstAnswers).toEqual([true, true, false, false, false]);
    expect(secondAnswers).toEqual([false, false, true, false, false]);
  });
});
