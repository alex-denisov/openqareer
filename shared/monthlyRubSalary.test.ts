import { describe, expect, it } from 'vitest';
import type { CurrencyRates } from './currencyRates';
import { monthlyAmount, monthlyRubSalary, salaryPeriodOf } from './monthlyRubSalary';

const rates: CurrencyRates = { date: '2026-11-23', rubPerUnit: { USD: 90, EUR: 100, PLN: 25 } };

describe('иностранная сумма 100–999 без периода — период неизвестен (B765, решение 23.11)', () => {
  it('per diem 450–600 USD, стипендия 450 EUR, ставка 140–180 PLN — не месяц и не год', () => {
    expect(salaryPeriodOf({ from: 450, to: 600, currency: 'USD' }, rates)).toBe('unknown');
    expect(salaryPeriodOf({ to: 450, currency: 'EUR' }, rates)).toBe('unknown');
    expect(salaryPeriodOf({ from: 140, to: 180, currency: 'PLN' }, rates)).toBe('unknown');
  });

  it('у неизвестного периода нет суммы в месяц', () => {
    expect(monthlyAmount(600, 'unknown')).toBeUndefined();
    expect(monthlyRubSalary({ from: 450, to: 600, currency: 'USD' }, rates)).toBeUndefined();
  });

  it('границы правила: меньше 100, от 1000, рубли и указанный период — как прежде', () => {
    expect(salaryPeriodOf({ from: 70, to: 99, currency: 'USD' }, rates)).toBe('month');
    expect(salaryPeriodOf({ from: 3_000, to: 4_000, currency: 'EUR' }, rates)).toBe('month');
    expect(salaryPeriodOf({ from: 500, to: 600, currency: 'RUR' }, rates)).toBe('month');
    expect(salaryPeriodOf({ from: 450, to: 600, currency: 'USD', period: 'month' }, rates)).toBe(
      'month',
    );
    expect(salaryPeriodOf({ from: 250, to: 400, currency: 'USD', period: 'hour' }, rates)).toBe(
      'hour',
    );
    expect(salaryPeriodOf({ from: 218_000, to: 265_000, currency: 'USD' }, rates)).toBe('year');
  });
});
