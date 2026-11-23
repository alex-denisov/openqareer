import { describe, expect, it } from 'vitest';
import { meetsMonthlySalaryMinimum } from './monthlySalaryMinimum';

const rates = { date: '2026-11-23', rubPerUnit: { USD: 90, EUR: 100 } };

describe('порог «Зарплата от» в месяц — одно правило клиента и сервера (B765, B645 s07)', () => {
  it('месячная и годовая вилки сравниваются верхней границей в валюте порога', () => {
    expect(
      meetsMonthlySalaryMinimum(
        { from: 300_000, to: 400_000, currency: 'RUR' },
        350_000,
        'RUB',
        rates,
      ),
    ).toBe(true);
    expect(
      meetsMonthlySalaryMinimum(
        { from: 300_000, to: 340_000, currency: 'RUR' },
        350_000,
        'RUB',
        rates,
      ),
    ).toBe(false);
    // 120 000 USD в год = 10 000 USD в месяц = 900 000 ₽.
    const yearly = { from: 100_000, to: 120_000, currency: 'USD', period: 'year' };
    expect(meetsMonthlySalaryMinimum(yearly, 900_000, 'RUB', rates)).toBe(true);
    expect(meetsMonthlySalaryMinimum(yearly, 900_001, 'RUB', rates)).toBe(false);
    expect(meetsMonthlySalaryMinimum({ from: 5_000, currency: 'EUR' }, 5_000, 'EUR', rates)).toBe(
      true,
    );
  });

  it('без суммы, ставка в час, период неизвестен или нет курса — строка остаётся как «не указана»', () => {
    expect(meetsMonthlySalaryMinimum(undefined, 900_000, 'RUB', rates)).toBe(true);
    expect(meetsMonthlySalaryMinimum({ currency: 'RUR' }, 900_000, 'RUB', rates)).toBe(true);
    expect(
      meetsMonthlySalaryMinimum(
        { from: 250, to: 400, currency: 'USD', period: 'hour' },
        900_000,
        'RUB',
        rates,
      ),
    ).toBe(true);
    expect(
      meetsMonthlySalaryMinimum({ from: 450, to: 600, currency: 'USD' }, 900_000, 'RUB', rates),
    ).toBe(true);
    expect(meetsMonthlySalaryMinimum({ from: 9_000, currency: 'GBP' }, 900_000, 'RUB', rates)).toBe(
      true,
    );
  });
});
