import { describe, expect, it } from 'vitest';
import { compareSalary } from '../public/assets/oq-salary-compare-1.js';

const money = (value) => `${value} ₽`;
describe('salary compare on 06a', () => {
  it('places a salary in the quartiles', () => {
    expect(compareSalary(90_000, 105_000, 125_000, 140_000, money)?.[0]).toBe(
      'Ниже, чем в 3 из 4 вакансий.',
    );
    expect(compareSalary(110_000, 105_000, 125_000, 140_000, money)?.[0]).toBe(
      'В нижней половине рынка.',
    );
    expect(compareSalary(130_000, 105_000, 125_000, 140_000, money)?.[0]).toBe(
      'В верхней половине рынка.',
    );
    expect(compareSalary(200_000, 105_000, 125_000, 140_000, money)?.[1]).toContain('140000 ₽');
    expect(compareSalary(Number.NaN, 1, 2, 3, money)).toBeNull();
  });
});
