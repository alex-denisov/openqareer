import { describe, expect, it } from 'vitest';
import { monthlyRubSalary } from './roleWageSalary';

const rates = { date: '2026-10-27', rubPerUnit: { USD: 80, EUR: 90 } };

describe('monthlyRubSalary: вилка роли по всем валютам (28.10)', () => {
  it('рубли оставляет как есть', () => {
    expect(monthlyRubSalary({ from: 300_000, to: 400_000, currency: 'RUR' }, rates)).toEqual({
      from: 300_000,
      to: 400_000,
      currency: 'RUB',
    });
  });

  it('годовую зарплату в долларах переводит в рубли в месяц', () => {
    expect(
      monthlyRubSalary({ from: 240_000, to: 300_000, currency: 'USD', period: 'year' }, rates),
    ).toEqual({ from: 1_600_000, to: 2_000_000, currency: 'RUB' });
  });

  it('месячную в евро делит только на курс', () => {
    expect(monthlyRubSalary({ from: 10_000, currency: 'EUR', period: 'month' }, rates)).toEqual({
      from: 900_000,
      currency: 'RUB',
    });
  });

  it('иностранная сумма без периода от 20 000 считается годовой', () => {
    expect(monthlyRubSalary({ from: 225_000, to: 275_000, currency: 'USD' }, rates)).toEqual({
      from: 1_500_000,
      to: 1_833_333,
      currency: 'RUB',
    });
  });

  it('почасовую ставку, валюту без курса и пустую зарплату не берёт', () => {
    expect(monthlyRubSalary({ from: 60, currency: 'USD', period: 'hour' }, rates)).toBeUndefined();
    expect(monthlyRubSalary({ from: 5_000, currency: 'MXN' }, rates)).toBeUndefined();
    expect(monthlyRubSalary({ currency: 'USD' }, rates)).toBeUndefined();
    expect(monthlyRubSalary({ from: 100_000, currency: 'USD' }, undefined)).toBeUndefined();
  });
});
