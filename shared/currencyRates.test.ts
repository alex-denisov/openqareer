import { describe, expect, it } from 'vitest';
import { convertAmount, type CurrencyRates } from './currencyRates';

const rates: CurrencyRates = { date: '2026-10-27', rubPerUnit: { USD: 80, EUR: 90, KZT: 0.16 } };

describe('convertAmount', () => {
  it('converts through rubles in both directions', () => {
    expect(convertAmount(1000, 'EUR', 'RUB', rates)).toBe(90_000);
    expect(convertAmount(90_000, 'RUB', 'EUR', rates)).toBe(1000);
    expect(convertAmount(800, 'USD', 'EUR', rates)).toBeCloseTo(711.11, 2);
  });

  it('treats hh RUR, the ruble sign and lowercase as rubles', () => {
    expect(convertAmount(100, 'RUR', 'rub', rates)).toBe(100);
    expect(convertAmount(1, '€', '₽', rates)).toBe(90);
  });

  it('returns undefined when a rate is unknown or rates are missing', () => {
    expect(convertAmount(100, 'GEL', 'RUB', rates)).toBeUndefined();
    expect(convertAmount(100, 'USD', 'RUB', undefined)).toBeUndefined();
    expect(convertAmount(100, 'USD', 'USD', undefined)).toBe(100);
  });
});
