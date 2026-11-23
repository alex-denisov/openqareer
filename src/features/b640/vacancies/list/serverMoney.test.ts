import { describe, expect, it } from 'vitest';
import { meetsMonthlySalaryMinimum } from '../../../../../shared/monthlySalaryMinimum';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { makeItem } from './fixtures';
import { EMPTY_FILTERS, applyFilters, serverMoney } from './filterModel';

const NOW = new Date('2026-11-11T10:00:00Z');
const rates = { date: '2026-11-11', rubPerUnit: { USD: 90, EUR: 100 } };

describe('«Зарплата от» для сервера (B765, B645 s07)', () => {
  it('порог в тысячах — сумма в месяц; «Как в вакансии» считается в рублях; без порога — null', () => {
    expect(serverMoney(EMPTY_FILTERS, 'RUB')).toBeNull();
    expect(serverMoney({ ...EMPTY_FILTERS, moneyFrom: 350 }, 'RUB')).toEqual({
      from: 350_000,
      currency: 'RUB',
    });
    expect(serverMoney({ ...EMPTY_FILTERS, moneyFrom: 5 }, 'USD')).toEqual({
      from: 5_000,
      currency: 'USD',
    });
    expect(serverMoney({ ...EMPTY_FILTERS, moneyFrom: 350 }, 'ORIG')).toEqual({
      from: 350_000,
      currency: 'RUB',
    });
  });

  it('сервер и клиент оставляют одни и те же строки', () => {
    const items: MatchedVacancyItem[] = [
      makeItem({ id: 'rub-high', salary: { from: 300_000, to: 400_000, currency: 'RUR' } }),
      makeItem({ id: 'rub-low', salary: { from: 200_000, to: 300_000, currency: 'RUR' } }),
      makeItem({ id: 'usd', salary: { from: 4_000, currency: 'USD' } }),
      makeItem({ id: 'eur-low', salary: { to: 3_000, currency: 'EUR' } }),
      makeItem({ id: 'per-diem', salary: { from: 450, to: 600, currency: 'USD' } }),
      makeItem({ id: 'no-rate', salary: { from: 9_000, currency: 'GBP' } }),
      makeItem({ id: 'none' }),
    ];
    for (const currency of ['RUB', 'USD', 'EUR'] as const) {
      const filters = { ...EMPTY_FILTERS, moneyFrom: currency === 'RUB' ? 350 : 4 };
      const money = serverMoney(filters, currency)!;
      const client = applyFilters(items, filters, { currency, rates, now: NOW }).map(
        (item) => item.cluster.id,
      );
      const server = items
        .filter((item) =>
          meetsMonthlySalaryMinimum(item.cluster.salary, money.from, money.currency, rates),
        )
        .map((item) => item.cluster.id);
      expect(server).toEqual(client);
    }
  });
});
