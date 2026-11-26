import { describe, expect, it } from 'vitest';
import { salaryFromJsonLd, salaryFromText } from './ownVacancySalary';

describe('деньги своей вакансии (B676)', () => {
  it('строка зарплаты в тексте: «от», «до», вилка, тысячи и период', () => {
    expect(salaryFromText('Руководитель\nЗарплата от 450 000 ₽\nТребования:')).toEqual({
      from: 450_000,
      currency: 'RUB',
    });
    expect(salaryFromText('Доход: 300–400 тыс. руб. в месяц')).toEqual({
      from: 300_000,
      to: 400_000,
      currency: 'RUB',
      period: 'month',
    });
    expect(salaryFromText('Оклад до 250k ₽')).toEqual({ to: 250_000, currency: 'RUB' });
    expect(salaryFromText('$114,000 - $130,000 a year')).toEqual({
      from: 114_000,
      to: 130_000,
      currency: 'USD',
      period: 'year',
    });
    expect(salaryFromText('Salary: €60–70 per hour')).toEqual({
      from: 60,
      to: 70,
      currency: 'EUR',
      period: 'hour',
    });
  });

  it('сумма без слова о зарплате и без вилки — не зарплата', () => {
    expect(
      salaryFromText('$250 Annual Stipend for Learning and Development\n401(k) match up to 3.5%'),
    ).toBeNull();
    expect(salaryFromText('Опыт от 5 лет; команда 9 человек')).toBeNull();
  });

  it('берётся строка зарплаты, а не первая сумма текста', () => {
    const text = '$250 Annual Stipend for Learning\n\n$114,000 - $130,000 a year';
    expect(salaryFromText(text)).toEqual({
      from: 114_000,
      to: 130_000,
      currency: 'USD',
      period: 'year',
    });
  });

  it('baseSalary из JSON-LD JobPosting', () => {
    expect(
      salaryFromJsonLd({
        '@type': 'MonetaryAmount',
        currency: 'USD',
        value: { minValue: 114000, maxValue: 130000, unitText: 'YEAR' },
      }),
    ).toEqual({ from: 114_000, to: 130_000, currency: 'USD', period: 'year' });
    expect(
      salaryFromJsonLd({ currency: 'RUB', value: { value: 300000, unitText: 'MONTH' } }),
    ).toEqual({
      from: 300_000,
      currency: 'RUB',
      period: 'month',
    });
    expect(salaryFromJsonLd({ currency: 'USD', value: { unitText: 'YEAR' } })).toBeNull();
    expect(salaryFromJsonLd(undefined)).toBeNull();
    expect(salaryFromJsonLd('120000')).toBeNull();
  });
});
