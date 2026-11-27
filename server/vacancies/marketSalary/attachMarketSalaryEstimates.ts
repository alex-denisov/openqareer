/** B546, B803: оценка openqareer у строк страницы без зарплаты. */
import type { MarketSalaryEstimateView } from '../../../shared/marketSalaryEstimate';
import type { MatchedVacancyItem } from '../multiSourceVacancyEngine';
import type { ReadTitle, SalaryEstimateReader } from '../openqareerSalary/salaryEstimateReader';

export interface MarketSalaryEstimateDeps {
  readonly store: SalaryEstimateReader;
  readonly readTitle: ReadTitle;
}

function hasSalary(item: MatchedVacancyItem): boolean {
  const salary = item.cluster.salary;
  return Boolean(salary && (salary.from !== undefined || salary.to !== undefined));
}

export function estimateFor(
  item: Pick<MatchedVacancyItem, 'cluster'>,
  deps: MarketSalaryEstimateDeps,
): MarketSalaryEstimateView | undefined {
  return deps.store.estimate(item.cluster, deps.readTitle);
}

export function attachMarketSalaryEstimates(
  items: readonly MatchedVacancyItem[],
  deps: MarketSalaryEstimateDeps,
): MatchedVacancyItem[] {
  return items.map((item) => {
    if (hasSalary(item)) return item;
    const marketSalary = estimateFor(item, deps);
    return marketSalary ? { ...item, explanation: { ...item.explanation, marketSalary } } : item;
  });
}
