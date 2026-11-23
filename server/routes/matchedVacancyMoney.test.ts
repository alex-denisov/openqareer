import { describe, expect, it } from 'vitest';
import { setCurrencyRates } from '../currency/cbrRates';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { compareMoneyRank, createMoneyReader } from './matchedVacancyMoney';

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
  const money = createMoneyReader();

  it('годовая вилка делится на 12, месячная — как есть', () => {
    // 218–265 тыс. USD в год: середина 241 500 / 12 × 90 ≈ 1,81 млн ₽.
    const yearly = money(item({ from: 218_000, to: 265_000, currency: 'USD', period: 'year' }));
    expect(yearly.tier).toBe('month');
    expect(yearly.tier === 'month' && yearly.value).toBeCloseTo(1_811_250, -3);
    expect(money(item({ from: 600_000, to: 800_000, currency: 'RUR' }))).toEqual({
      tier: 'month',
      value: 700_000,
    });
  });

  it('почасовая ставка не получает месячной суммы: своя группа в рублях в час', () => {
    expect(money(item({ from: 250, to: 400, currency: 'USD', period: 'hour' }))).toEqual({
      tier: 'hour',
      value: 29_250,
    });
  });
});

describe('порядок «Деньги»: суммы, затем ставки, затем «не указана» (B765, решение 23.11)', () => {
  setCurrencyRates({ date: '2026-11-23', rubPerUnit: { USD: 90 } });
  const money = createMoneyReader();
  const row = (id: string, salary?: Parameters<typeof item>[0], market?: object) =>
    ({
      cluster: { id, canonicalTitle: 'CTO', ...(salary ? { salary } : {}) },
      explanation: market ? { marketSalary: market } : {},
    }) as unknown as MatchedVacancyItem;

  it('скрытая оценка рынка порядок не задаёт: строка без суммы — «не указана»', () => {
    const noSalary = row('n', undefined, { low: 900_000, high: 1_200_000, currency: 'RUR' });
    expect(money(noSalary)).toEqual({ tier: 'none' });
  });

  it('«не указана» после всех сумм и ставок в обе стороны', () => {
    const rows = [
      row('none', undefined, { low: 5_000_000, high: 6_000_000, currency: 'RUR' }),
      row('hour', { from: 250, to: 400, currency: 'USD', period: 'hour' }),
      row('low', { from: 200_000, to: 250_000, currency: 'RUR' }),
      row('high', { from: 218_000, to: 265_000, currency: 'USD', period: 'year' }),
      row('hourLow', { from: 20, to: 25, currency: 'USD', period: 'hour' }),
    ];
    const order = (dir: 'asc' | 'desc') =>
      [...rows].sort((a, b) => compareMoneyRank(money(a), money(b), dir)).map((r) => r.cluster.id);
    expect(order('desc')).toEqual(['high', 'low', 'hour', 'hourLow', 'none']);
    expect(order('asc')).toEqual(['low', 'high', 'hourLow', 'hour', 'none']);
  });
});
