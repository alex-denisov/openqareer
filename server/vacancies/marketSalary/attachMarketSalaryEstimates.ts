/**
 * B546: adds the precomputed market estimate to page items without salary.
 * Two primary-key reads per item at most; nothing is computed on a request.
 */
import {
  marketSalaryCity,
  marketSalaryKey,
  pickMarketSalaryEstimate,
  type MarketSalaryBasis,
  type MarketSalaryEstimateView,
} from '../../../shared/marketSalaryEstimate';
import type { MatchedVacancyItem } from '../multiSourceVacancyEngine';
import { normalizeTitleKey } from '../titleParse/normalizeTitleKey';
import { marketSalaryCityPlace, marketSalaryCountry } from './marketSalaryCountry';
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

export function estimateFor(
  item: Pick<MatchedVacancyItem, 'cluster'>,
  deps: MarketSalaryEstimateDeps,
): MarketSalaryEstimateView | undefined {
  const parsed = deps.readTitle(normalizeTitleKey(item.cluster.canonicalTitle));
  const functionCode = parsed?.functions[0];
  if (!parsed || !functionCode) return undefined;
  const location = item.cluster.canonicalLocation;
  const country = marketSalaryCountry(location);
  if (!country) return undefined;
  const city = marketSalaryCity(location);
  const read = (basis: MarketSalaryBasis, place: string) =>
    deps.store.get(marketSalaryKey(functionCode, parsed.levelRank, basis, place));
  // Старый ключ города живёт до первого прохода после B803; в России он не смешивал страны.
  const cityEstimate = city
    ? (read('city', marketSalaryCityPlace(country, city)) ??
      (country === 'RU' ? read('city', city) : undefined))
    : undefined;
  const countryEstimate = read('country', country);
  const picked = pickMarketSalaryEstimate(cityEstimate, countryEstimate);
  if (!picked) return undefined;
  const source = picked.basis === 'city' ? cityEstimate : countryEstimate;
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
