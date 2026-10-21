import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { CANDIDATE_REGION_CATALOGUE } from '../workspace/candidateRegions';
import { titleMatchesRole } from '../../../shared/vacancyRoleTitleMatch';
import {
  filterVacanciesByDecisionProfile,
  loadDecisionProfile,
} from '../../../shared/workPreferences';
import type { VacanciesScreenState } from './VacanciesScreenFilters';
import { matchesVacancyCity } from './vacancyFacets';
import { matchesLocationSelection } from '../../../shared/locationTree';

export interface VacancyScreenFilterOptions {
  readonly locations: readonly { readonly id: string; readonly label: string; readonly count: number }[];
  readonly salaryCurrencies: readonly string[];
  readonly formatCounts: Readonly<Record<string, number>>;
}

export function vacancyFormat(item: MatchedVacancyItem): string {
  const location = item.cluster.canonicalLocation ?? '';
  const context = `${location} ${item.cluster.descriptionSummary}`.toLocaleLowerCase('ru-RU');
  if (/гибрид|hybrid/u.test(context)) return 'hybrid';
  if (/офис|on[- ]?site|in[- ]?person|office/u.test(context)) return 'office';
  return item.cluster.isRemote ? 'remote' : 'unknown';
}

function matchesSalaryRange(item: MatchedVacancyItem, state: VacanciesScreenState): boolean {
  if (state.salaryMinimum === undefined && state.salaryMaximum === undefined) return true;
  const salary = item.cluster.salary;
  const currencyMatches = !state.salaryCurrency ||
    salary?.currency?.toLocaleUpperCase('ru-RU') === state.salaryCurrency.toLocaleUpperCase('ru-RU');
  if (!salary || !currencyMatches) return Boolean(state.includeMissingSalary);
  const lower = salary.from ?? salary.to;
  const upper = salary.to ?? salary.from;
  if (state.salaryMinimum !== undefined && (upper ?? -Infinity) < state.salaryMinimum) return false;
  if (state.salaryMaximum !== undefined && (lower ?? Infinity) > state.salaryMaximum) return false;
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
  if (selected.length || state.locationRemote) {
    const place = { location, country: item.cluster.companyFeatures?.country };
    const inRemote = Boolean(state.locationRemote && item.cluster.isRemote);
    if (!inRemote && !(selected.length && matchesLocationSelection(place, selected))) return false;
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
  for (const item of items) {
    const location = item.cluster.canonicalLocation?.trim();
    if (location) locations.set(location, (locations.get(location) ?? 0) + 1);
    if (item.cluster.salary?.currency) currencies.add(item.cluster.salary.currency);
    const format = vacancyFormat(item);
    formatCounts[format] = (formatCounts[format] ?? 0) + 1;
  }
  return {
    locations: [...locations].map(([id, count]) => ({ id, label: id, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'ru-RU')),
    salaryCurrencies: [...currencies].sort(),
    formatCounts,
  };
}
