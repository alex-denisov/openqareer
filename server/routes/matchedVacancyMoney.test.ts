import { describe, expect, it } from 'vitest';
import { setCurrencyRates } from '../currency/cbrRates';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { createMoneyReader } from './matchedVacancyMoney';

function item(salary: {
  from?: number;
  to?: number;
  currency: string;
  period?: 'hour' | 'month' | 'year';
}) {
  return {
    cluster: { id: 'x', canonicalTitle: 'CTO', salary },
    explanation: {},
  } as unknown as MatchedVacancyItem;
}

describe('порядок «Деньги» — сумма в рублях в месяц (B765)', () => {
  setCurrencyRates({ date: '2026-11-23', rubPerUnit: { USD: 90 } });
  const money = createMoneyReader({
    marketSalaryEstimates: undefined,
    titleParseStore: { getByKey: () => undefined },
  } as unknown as Parameters<typeof createMoneyReader>[0]);

  it('годовая вилка делится на 12, месячная — как есть', () => {
    // 218–265 тыс. USD в год: середина 241 500 / 12 × 90 ≈ 1,81 млн ₽.
    expect(
      money(item({ from: 218_000, to: 265_000, currency: 'USD', period: 'year' })),
    ).toBeCloseTo(1_811_250, -3);
    expect(money(item({ from: 600_000, to: 800_000, currency: 'RUR' }))).toBe(700_000);
  });

  it('почасовая ставка не получает месячной суммы и идёт с вакансиями без денег', () => {
    expect(money(item({ from: 250, to: 400, currency: 'USD', period: 'hour' }))).toBeUndefined();
  });
});
