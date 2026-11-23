import { convertAmount, type CurrencyRates } from '../../shared/currencyRates';
import { salaryPeriodOf } from '../../shared/monthlyRubSalary';
import { salaryMidpoint } from '../../shared/marketSalaryEstimate';
import type { VacancySortDirection } from '../../shared/vacancySort';
import { getCurrencyRates } from '../currency/cbrRates';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { monthlyRubSalary } from '../vacancies/roleWageSalary';

/**
 * Место строки в порядке «Деньги»: сумма в рублях в месяц, затем почасовая ставка в рублях в час,
 * затем «не указана». Ставку с месячной суммой не сравнить — она идёт своей группой.
 */
export type MoneyRank =
  | { readonly tier: 'month'; readonly value: number }
  | { readonly tier: 'hour'; readonly value: number }
  | { readonly tier: 'none' };

export type MoneyReader = (item: MatchedVacancyItem) => MoneyRank;

const TIER_ORDER = { month: 0, hour: 1, none: 2 } as const;
const NONE: MoneyRank = { tier: 'none' };

type Salary = NonNullable<MatchedVacancyItem['cluster']['salary']>;

function hourlyRub(salary: Salary, rates: CurrencyRates | undefined): number | undefined {
  const from = salary.from && salary.from > 0 ? salary.from : undefined;
  const to = salary.to && salary.to > 0 ? salary.to : undefined;
  const rate = from !== undefined && to !== undefined ? (from + to) / 2 : (from ?? to);
  return rate === undefined
    ? undefined
    : convertAmount(rate, salary.currency ?? 'RUR', 'RUB', rates);
}

function rankOf(salary: Salary, rates: CurrencyRates | undefined): MoneyRank {
  if (salaryPeriodOf(salary, rates) === 'hour') {
    const value = hourlyRub(salary, rates);
    return value === undefined ? NONE : { tier: 'hour', value };
  }
  const monthly = monthlyRubSalary(salary, rates);
  const value = monthly ? salaryMidpoint(monthly) : undefined;
  return value === undefined ? NONE : { tier: 'month', value };
}

/**
 * «Деньги» (решение оркестратора 23.11, B645): только сумма из вакансии. Оценка рынка порядок не
 * задаёт — по DESIGN.md денег без источника нет; раньше (29.10) строки без суммы шли по оценке.
 */
export function createMoneyReader(): MoneyReader {
  const rates = getCurrencyRates();
  return (item) => {
    const salary = item.cluster.salary;
    return salary && (salary.from || salary.to) ? rankOf(salary, rates) : NONE;
  };
}

/** Группы «сумма → ставка → не указана» в обе стороны; внутри группы — по направлению. */
export function compareMoneyRank(
  left: MoneyRank | undefined,
  right: MoneyRank | undefined,
  dir: VacancySortDirection,
): number {
  const a = left ?? NONE;
  const b = right ?? NONE;
  const byTier = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
  if (byTier !== 0 || a.tier === 'none' || b.tier === 'none') return byTier;
  return dir === 'desc' ? b.value - a.value : a.value - b.value;
}
