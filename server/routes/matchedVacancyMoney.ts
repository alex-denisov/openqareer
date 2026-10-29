import type { CurrencyRates } from '../../shared/currencyRates';
import { salaryMidpoint } from '../../shared/marketSalaryEstimate';
import { getCurrencyRates } from '../currency/cbrRates';
import { estimateFor } from '../vacancies/marketSalary/attachMarketSalaryEstimates';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { monthlyRubSalary } from '../vacancies/roleWageSalary';
import type { RouteDeps } from './deps';

export type MoneyReader = (item: MatchedVacancyItem) => number | undefined;

/** Midpoint of a range in RUB per month, or undefined when it cannot be converted. */
function monthlyRub(
  salary: { from?: number; to?: number; currency?: string; period?: 'hour' | 'month' | 'year' },
  rates: CurrencyRates | undefined,
): number | undefined {
  const monthly = monthlyRubSalary(salary, rates);
  return monthly ? salaryMidpoint(monthly) : undefined;
}

/**
 * «Деньги» order (owner 29.10): the stated salary, else the market estimate the row shows, both
 * normalised to RUB per month. Two primary-key reads per vacancy without salary at most.
 */
export function createMoneyReader(
  deps: Pick<RouteDeps, 'marketSalaryEstimates' | 'titleParseStore'>,
): MoneyReader {
  const rates = getCurrencyRates();
  const store = deps.marketSalaryEstimates;
  return (item) => {
    const salary = item.cluster.salary;
    if (salary && (salary.from || salary.to)) return monthlyRub(salary, rates);
    const estimate =
      item.explanation.marketSalary ??
      (store
        ? estimateFor(item, {
            store,
            readTitle: (key) => deps.titleParseStore.getByKey(key) ?? undefined,
          })
        : undefined);
    if (!estimate || estimate.low === undefined || estimate.high === undefined) return undefined;
    return monthlyRub(
      { from: estimate.low, to: estimate.high, currency: estimate.currency },
      rates,
    );
  };
}
