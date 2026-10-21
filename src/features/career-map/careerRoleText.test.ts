import { describe, expect, it } from 'vitest';
import { withoutTrailingPeriod } from './CareerRoleComponents';
import { formatVacancyCount } from './careerWageFork';

describe('тексты роли на «Карьере» (B445-r1)', () => {
  it('склоняет число вакансий', () => {
    expect([1, 2, 5, 11, 21].map(formatVacancyCount)).toEqual([
      '1 вакансия',
      '2 вакансии',
      '5 вакансий',
      '11 вакансий',
      '21 вакансия',
    ]);
  });

  it('убирает конечную точку причины перед склейкой и не трогает причину без неё', () => {
    expect(withoutTrailingPeriod('Синтетическая роль профиля.')).toBe('Синтетическая роль профиля');
    expect(withoutTrailingPeriod('Синтетическая роль профиля')).toBe('Синтетическая роль профиля');
  });
});
