import { convertAmount, type CurrencyRates } from '../../shared/currencyRates';
import { salaryPeriodOf } from '../../shared/monthlyRubSalary';
import { salaryMidpoint } from '../../shared/marketSalaryEstimate';
import type { VacancySortDirection } from '../../shared/vacancySort';
import { getCurrencyRates } from '../currency/cbrRates';
import { estimateFor } from '../vacancies/marketSalary/attachMarketSalaryEstimates';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { mapYielding } from '../vacancies/mapYielding';
import { monthlyRubSalary } from '../vacancies/roleWageSalary';
import type { RouteDeps } from './deps';

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
  return monthRank(salary, rates);
}

function monthRank(salary: Salary, rates: CurrencyRates | undefined): MoneyRank {
  const monthly = monthlyRubSalary(salary, rates);
  const value = monthly ? salaryMidpoint(monthly) : undefined;
  return value === undefined ? NONE : { tier: 'month', value };
}

/**
 * «Деньги» order (owner 29.10): the stated salary, else the market estimate the row shows, both
 * normalised to RUB per month. Two primary-key reads per vacancy without salary at most.
 * B765: an hourly rate goes in its own group after them; a stated amount whose period is unknown
 * (foreign 100–999 without a period) has no month and goes with «не указана».
 */
export function createMoneyReader(
  deps: Pick<RouteDeps, 'marketSalaryEstimates' | 'titleParseStore'>,
): MoneyReader {
  const rates = getCurrencyRates();
  const store = deps.marketSalaryEstimates;
  return (item) => {
    const salary = item.cluster.salary;
    if (salary && (salary.from || salary.to)) return rankOf(salary, rates);
    const estimate =
      item.explanation.marketSalary ??
      (store
        ? estimateFor(item, {
            store,
            readTitle: (key) => deps.titleParseStore.getByKey(key) ?? undefined,
          })
        : undefined);
    if (!estimate || estimate.low === undefined || estimate.high === undefined) return NONE;
    const { low, high, currency, period } = estimate;
    return monthRank({ from: low, to: high, currency, period }, rates);
  };
}

/** B803: `prepare` читает оценки порциями с уступкой event loop, порядок берёт готовые. */
export function createPreparedMoney(deps: Parameters<typeof createMoneyReader>[0]) {
  const read = createMoneyReader(deps);
  let ranks: ReadonlyMap<string, MoneyRank> = new Map();
  const money: MoneyReader = (item) => ranks.get(item.cluster.id) ?? read(item);
  const prepare = async (items: readonly MatchedVacancyItem[]): Promise<void> => {
    ranks = new Map(await mapYielding(items, (item) => [item.cluster.id, read(item)] as const));
  };
  return Object.assign(money, { prepare });
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
