/**
 * B546: adds the precomputed market estimate to page items without salary.
 * Two primary-key reads per item at most; nothing is computed on a request.
 */
import {
  marketSalaryCity,
  marketSalaryKey,
  pickMarketSalaryEstimate,
  type MarketSalaryEstimateView,
} from '../../../shared/marketSalaryEstimate';
import type { MatchedVacancyItem } from '../multiSourceVacancyEngine';
import { matchedVacancyRegion } from '../matchedVacancyFacets';
import { normalizeTitleKey } from '../titleParse/normalizeTitleKey';
import type { StoredMarketSalaryEstimate } from './sqliteMarketSalaryEstimateStore';

export interface MarketSalaryEstimateDeps {
  readonly store: { get(key: string): StoredMarketSalaryEstimate | undefined };
  readonly readTitle: (
    titleKey: string,
  ) => { readonly functions: readonly string[]; readonly levelRank: number | null } | undefined;
}

function hasSalary(item: MatchedVacancyItem): boolean {
  const salary = item.cluster.salary;
  return Boolean(salary && (salary.from !== undefined || salary.to !== undefined));
}

function estimateFor(
  item: MatchedVacancyItem,
  deps: MarketSalaryEstimateDeps,
): MarketSalaryEstimateView | undefined {
  const parsed = deps.readTitle(normalizeTitleKey(item.cluster.canonicalTitle));
  const functionCode = parsed?.functions[0];
  if (!parsed || !functionCode) return undefined;
  const city = marketSalaryCity(item.cluster.canonicalLocation);
  const region = matchedVacancyRegion(item);
  const cityEstimate = city
    ? deps.store.get(marketSalaryKey(functionCode, parsed.levelRank, 'city', city))
    : undefined;
  const regionEstimate = region
    ? deps.store.get(marketSalaryKey(functionCode, parsed.levelRank, 'region', region))
    : undefined;
  const picked = pickMarketSalaryEstimate(cityEstimate, regionEstimate);
  if (!picked) return undefined;
  const source = picked.basis === 'city' ? cityEstimate : regionEstimate;
  return { ...picked, computedAt: source?.computedAt ?? '' };
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
