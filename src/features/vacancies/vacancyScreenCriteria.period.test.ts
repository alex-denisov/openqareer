import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { CurrencyRates } from '../../../shared/currencyRates';
import { filterByScreenState } from './vacancyScreenCriteria';
import type { VacanciesScreenState } from './vacanciesScreenState';

function item(
  id: string,
  salary: { from?: number; to?: number; currency: string; period?: string },
) {
  return {
    cluster: { id, canonicalTitle: 'CTO', isRemote: false, salary, sources: [] },
    explanation: { clusterId: id },
  } as unknown as MatchedVacancyItem;
}

// Прод 23.11, «Карьера» ?role=CTO: Egen — в год, Arootah — в час (B765).
const items = [
  item('egen-year', { from: 218_000, to: 265_000, currency: 'USD', period: 'year' }),
  item('arootah-hour', { from: 250, to: 400, currency: 'USD', period: 'hour' }),
  item('moscow-month', { from: 600_000, to: 800_000, currency: 'RUR' }),
];
const rates: CurrencyRates = { date: '2026-11-23', rubPerUnit: { USD: 90 } };
const from = (salaryMinimum: number, includeMissingSalary = false): VacanciesScreenState => ({
  roles: [],
  regions: [],
  remoteOnly: false,
  salaryMinimum,
  salaryCurrency: 'RUR',
  includeMissingSalary,
});
const ids = (state: VacanciesScreenState) =>
  filterByScreenState(items, state, '2026-11-23', rates).map((entry) => entry.cluster.id);

describe('«Деньги от» сравнивает сумму в месяц (B765)', () => {
  it('годовая вилка делится на 12: 265 тыс. USD в год — ≈ 1 988 тыс. ₽ в месяц', () => {
    expect(ids(from(1_900_000))).toEqual(['egen-year']);
    expect(ids(from(2_500_000))).toEqual([]);
  });

  it('почасовая ставка с месячным порогом не сравнивается', () => {
    // 400 USD в час = 36 тыс. ₽ — это не месячные деньги, порог 30 тыс. в месяц её не берёт.
    expect(ids(from(30_000))).toEqual(['egen-year', 'moscow-month']);
  });

  it('с «не указана» почасовая остаётся там же, где вакансии без зарплаты', () => {
    expect(ids(from(2_500_000, true))).toEqual(['arootah-hour']);
  });
});
