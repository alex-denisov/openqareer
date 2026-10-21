import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { CANDIDATE_REGION_CATALOGUE } from '../workspace/candidateRegions';
import { titleMatchesRole } from '../../../shared/vacancyRoleTitleMatch';
import {
  filterVacanciesByDecisionProfile,
  loadDecisionProfile,
} from '../../../shared/workPreferences';
import type { VacanciesScreenState } from './VacanciesScreenFilters';
import { matchesVacancyCity } from './vacancyFacets';

export interface VacancyScreenFilterOptions {
  readonly locations: readonly { readonly id: string; readonly label: string; readonly count: number }[];
  readonly salaryCurrencies: readonly string[];
  /** Loaded vacancies without salary that carry a market estimate number (B546). */
  readonly marketEstimateCount: number;
  readonly formatCounts: Readonly<Record<string, number>>;
}

export function vacancyFormat(item: MatchedVacancyItem): string {
  const location = item.cluster.canonicalLocation ?? '';
  const context = `${location} ${item.cluster.descriptionSummary}`.toLocaleLowerCase('ru-RU');
  if (/гибрид|hybrid/u.test(context)) return 'hybrid';
  if (/офис|on[- ]?site|in[- ]?person|office/u.test(context)) return 'office';
  return item.cluster.isRemote ? 'remote' : 'unknown';
}

function sameCurrency(currency: string | undefined, wanted: string | undefined): boolean {
  return !wanted || currency?.toLocaleUpperCase('ru-RU') === wanted.toLocaleUpperCase('ru-RU');
}

/** Stated salary, or the market estimate when the candidate asked to compare by it (B546). */
function comparableSalary(
  item: MatchedVacancyItem,
  state: VacanciesScreenState,
): { readonly lower?: number; readonly upper?: number } | undefined {
  const salary = item.cluster.salary;
  if (salary) {
    if (!sameCurrency(salary.currency, state.salaryCurrency)) return undefined;
    return { lower: salary.from ?? salary.to, upper: salary.to ?? salary.from };
  }
  const estimate = item.explanation.marketSalary;
  if (!state.useMarketEstimate || estimate?.low === undefined || estimate.high === undefined) {
    return undefined;
  }
  if (!sameCurrency(estimate.currency, state.salaryCurrency)) return undefined;
  return { lower: estimate.low, upper: estimate.high };
}

function matchesSalaryRange(item: MatchedVacancyItem, state: VacanciesScreenState): boolean {
  if (state.salaryMinimum === undefined && state.salaryMaximum === undefined) return true;
  const range = comparableSalary(item, state);
  if (!range) return Boolean(state.includeMissingSalary);
  if (state.salaryMinimum !== undefined && (range.upper ?? -Infinity) < state.salaryMinimum) return false;
  if (state.salaryMaximum !== undefined && (range.lower ?? Infinity) > state.salaryMaximum) return false;
  return true;
}

function matchesScreenLocation(
  item: MatchedVacancyItem,
  state: VacanciesScreenState,
  allItems: readonly MatchedVacancyItem[],
): boolean {
  const location = item.cluster.canonicalLocation?.trim() ?? '';
  const normalized = location.toLocaleLowerCase('ru-RU');
  const search = state.locationSearch?.trim().toLocaleLowerCase('ru-RU');
  if (search && !normalized.includes(search)) return false;
  const selected = state.selectedLocations ?? [];
  if (selected.length && !selected.some((value) => normalized.includes(value.toLocaleLowerCase('ru-RU')))) {
    return false;
  }
  if (state.selectedCity && !matchesVacancyCity(item, state.selectedCity, allItems)) return false;
  if (state.regions.length && !state.remoteOnly) {
    const inRegion = state.regions.some((region) => {
      const label = CANDIDATE_REGION_CATALOGUE.find((entry) => entry.id === region)?.label ?? region;
      return normalized.includes(region.toLocaleLowerCase('ru-RU')) ||
        normalized.includes(label.toLocaleLowerCase('ru-RU'));
    });
    if (!inRegion && !item.cluster.isRemote) return false;
  }
  return true;
}

function matchesScreenCriteria(
  item: MatchedVacancyItem,
  state: VacanciesScreenState,
  allItems: readonly MatchedVacancyItem[],
): boolean {
  const { cluster } = item;
  if (state.roles.length && !state.roles.some((role) => titleMatchesRole(cluster.canonicalTitle, role))) return false;
  if (state.remoteOnly && !cluster.isRemote) return false;
  if (state.sources?.length && !cluster.sources.some((source) => state.sources?.includes(source.sourceId))) return false;
  if (!matchesScreenLocation(item, state, allItems) || !matchesSalaryRange(item, state)) return false;
  return !state.formats?.length || state.formats.includes(vacancyFormat(item));
}

export function filterByScreenState(
  items: readonly MatchedVacancyItem[],
  state: VacanciesScreenState,
  now: string,
): MatchedVacancyItem[] {
  void now;
  return filterVacanciesByDecisionProfile(items, loadDecisionProfile()).filter((item) =>
    matchesScreenCriteria(item, state, items),
  );
}

export function buildVacancyFilterOptions(
  items: readonly MatchedVacancyItem[],
): VacancyScreenFilterOptions {
  const locations = new Map<string, number>();
  const currencies = new Set<string>();
  const formatCounts: Record<string, number> = { remote: 0, hybrid: 0, office: 0, unknown: 0 };
  let marketEstimateCount = 0;
  for (const item of items) {
    const location = item.cluster.canonicalLocation?.trim();
    if (location) locations.set(location, (locations.get(location) ?? 0) + 1);
    if (item.cluster.salary?.currency) currencies.add(item.cluster.salary.currency);
    const estimate = item.explanation.marketSalary;
    if (!item.cluster.salary && estimate?.low !== undefined) {
      currencies.add(estimate.currency);
      marketEstimateCount += 1;
    }
    const format = vacancyFormat(item);
    formatCounts[format] = (formatCounts[format] ?? 0) + 1;
  }
  return {
    locations: [...locations].map(([id, count]) => ({ id, label: id, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'ru-RU')),
    salaryCurrencies: [...currencies].sort(),
    marketEstimateCount,
    formatCounts,
  };
}
