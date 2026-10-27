import { detectVacancyWorkFormat, type VacancyWorkFormat } from '../../../shared/vacancyWorkFormat';
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
import { convertAmount, type CurrencyRates } from '../../../shared/currencyRates';

export interface VacancyScreenFilterOptions {
  readonly locations: readonly {
    readonly id: string;
    readonly label: string;
    readonly count: number;
  }[];
  readonly salaryCurrencies: readonly string[];
  /** Loaded vacancies without salary that carry a market estimate number (B546). */
  readonly marketEstimateCount: number;
  readonly formatCounts: Readonly<Record<string, number>>;
}

export function vacancyFormat(item: MatchedVacancyItem): VacancyWorkFormat {
  return (
    item.cluster.workFormat ??
    detectVacancyWorkFormat({
      location: item.cluster.canonicalLocation,
      summary: item.cluster.descriptionSummary,
      isRemote: item.cluster.isRemote,
    })
  );
}

const CURRENCY_ALIASES: Readonly<Record<string, string>> = {
  '₽': 'RUR',
  RUB: 'RUR',
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
};

/** hh.ru says RUR, fixtures and boards say ₽ or RUB: one currency for the filter. */
export function normalizeSalaryCurrency(currency: string): string {
  const code = currency.trim().toUpperCase();
  return CURRENCY_ALIASES[code] ?? code;
}

/** Валюта фильтра «Зарплата» по умолчанию — из условий кандидата, если она есть в выдаче. */
export function defaultSalaryCurrency(
  currencies: readonly string[],
  candidateCurrency: string | undefined,
): string {
  const wanted = candidateCurrency ? normalizeSalaryCurrency(candidateCurrency) : undefined;
  const match = wanted
    ? currencies.find((currency) => normalizeSalaryCurrency(currency) === wanted)
    : undefined;
  return match ?? currencies[0] ?? '';
}

/** Сумма вакансии в валюте порога: та же валюта как есть, другая — по курсу ЦБ (CPO 27.10). */
function inWantedCurrency(
  amount: number | undefined,
  currency: string | undefined,
  wanted: string | undefined,
  rates: CurrencyRates | undefined,
): number | undefined {
  if (amount === undefined || !wanted) return amount;
  if (currency === undefined) return undefined;
  return convertAmount(
    amount,
    normalizeSalaryCurrency(currency),
    normalizeSalaryCurrency(wanted),
    rates,
  );
}

function convertedRange(
  lower: number | undefined,
  upper: number | undefined,
  currency: string | undefined,
  state: VacanciesScreenState,
  rates: CurrencyRates | undefined,
): { readonly lower?: number; readonly upper?: number } | undefined {
  const low = inWantedCurrency(lower, currency, state.salaryCurrency, rates);
  const high = inWantedCurrency(upper, currency, state.salaryCurrency, rates);
  if (low === undefined && high === undefined) return undefined;
  return { lower: low, upper: high };
}

/** Stated salary, or the market estimate when the candidate asked to compare by it (B546). */
function comparableSalary(
  item: MatchedVacancyItem,
  state: VacanciesScreenState,
  rates: CurrencyRates | undefined,
): { readonly lower?: number; readonly upper?: number } | undefined {
  const salary = item.cluster.salary;
  if (salary) {
    const lower = salary.from ?? salary.to;
    const upper = salary.to ?? salary.from;
    return convertedRange(lower, upper, salary.currency, state, rates);
  }
  const estimate = item.explanation.marketSalary;
  if (!state.useMarketEstimate || estimate?.low === undefined || estimate.high === undefined) {
    return undefined;
  }
  return convertedRange(estimate.low, estimate.high, estimate.currency, state, rates);
}

function matchesSalaryRange(
  item: MatchedVacancyItem,
  state: VacanciesScreenState,
  rates: CurrencyRates | undefined,
): boolean {
  if (state.salaryMinimum === undefined && state.salaryMaximum === undefined) return true;
  const range = comparableSalary(item, state, rates);
  if (!range) return Boolean(state.includeMissingSalary);
  if (state.salaryMinimum !== undefined && (range.upper ?? -Infinity) < state.salaryMinimum)
    return false;
  if (state.salaryMaximum !== undefined && (range.lower ?? Infinity) > state.salaryMaximum)
    return false;
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
  const cities = state.selectedCities ?? [];
  if (cities.length && !cities.some((city) => matchesVacancyCity(item, city, allItems)))
    return false;
  if (state.regions.length && !state.remoteOnly) {
    const inRegion = state.regions.some((region) => {
      const label =
        CANDIDATE_REGION_CATALOGUE.find((entry) => entry.id === region)?.label ?? region;
      return (
        normalized.includes(region.toLocaleLowerCase('ru-RU')) ||
        normalized.includes(label.toLocaleLowerCase('ru-RU'))
      );
    });
    if (!inRegion && !item.cluster.isRemote) return false;
  }
  return true;
}

function sameCompany(company: string, wanted: string): boolean {
  return company.trim().toLocaleLowerCase('ru-RU') === wanted.trim().toLocaleLowerCase('ru-RU');
}

function matchesScreenCriteria(
  item: MatchedVacancyItem,
  state: VacanciesScreenState,
  allItems: readonly MatchedVacancyItem[],
  rates: CurrencyRates | undefined,
): boolean {
  const { cluster } = item;
  if (
    state.roles.length &&
    !state.roles.some((role) => titleMatchesRole(cluster.canonicalTitle, role))
  )
    return false;
  if (state.remoteOnly && !cluster.isRemote) return false;
  if (state.companyName && !sameCompany(cluster.canonicalCompany, state.companyName)) return false;
  if (
    state.sources?.length &&
    !cluster.sources.some((source) => state.sources?.includes(source.sourceId))
  )
    return false;
  if (!matchesScreenLocation(item, state, allItems) || !matchesSalaryRange(item, state, rates))
    return false;
  return !state.formats?.length || state.formats.includes(vacancyFormat(item));
}

export function filterByScreenState(
  items: readonly MatchedVacancyItem[],
  state: VacanciesScreenState,
  now: string,
  rates?: CurrencyRates,
): MatchedVacancyItem[] {
  void now;
  return filterVacanciesByDecisionProfile(items, loadDecisionProfile()).filter((item) =>
    matchesScreenCriteria(item, state, items, rates),
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
    if (item.cluster.salary?.currency)
      currencies.add(normalizeSalaryCurrency(item.cluster.salary.currency));
    const estimate = item.explanation.marketSalary;
    if (!item.cluster.salary && estimate?.low !== undefined) {
      currencies.add(normalizeSalaryCurrency(estimate.currency));
      marketEstimateCount += 1;
    }
    const format = vacancyFormat(item);
    formatCounts[format] = (formatCounts[format] ?? 0) + 1;
  }
  return {
    locations: [...locations]
      .map(([id, count]) => ({ id, label: id, count }))
      .sort(
        (left, right) => right.count - left.count || left.label.localeCompare(right.label, 'ru-RU'),
      ),
    salaryCurrencies: [...currencies].sort(),
    marketEstimateCount,
    formatCounts,
  };
}
