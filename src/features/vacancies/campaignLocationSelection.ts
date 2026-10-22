import {
  parseVacancyLocation,
  selectedVacancyCount,
  type LocationTree,
} from '../../../shared/locationTree';
import type { MatchedVacancyPlaceFacet } from '../../../shared/matchedVacancyFacets';
import type { VacanciesScreenState } from './vacanciesScreenState';

/**
 * B446-r (W6): регион кампании («Россия, СНГ») — это выбор в «Локациях».
 * Страна дерева отмечена, если сервер отнёс её места к одному из регионов.
 */
export function countryKeysForRegions(
  tree: LocationTree,
  places: readonly MatchedVacancyPlaceFacet[],
  regions: readonly string[],
): string[] {
  if (!regions.length) return [];
  const wanted = new Set(regions);
  const countries = new Set<string>();
  for (const place of places) {
    if (!place.region || !wanted.has(place.region)) continue;
    const country = parseVacancyLocation(place)?.country;
    if (country) countries.add(country);
  }
  return tree.countries.filter((node) => countries.has(node.label)).map((node) => node.key);
}

function hasManualLocation(state: VacanciesScreenState): boolean {
  return Boolean(
    state.selectedLocations?.length ||
    state.locationRemote ||
    state.selectedCity ||
    state.selectedCities?.length ||
    state.locationSearch?.trim(),
  );
}

/**
 * Что показать отмеченным: ручной выбор, а без него — регионы фильтра или
 * кампании. Возвращает состояние для дерева и признак «выбор из регионов».
 */
export function locationSelectionView(
  state: VacanciesScreenState,
  tree: LocationTree,
  places: readonly MatchedVacancyPlaceFacet[],
  campaignRegions: readonly string[],
): { readonly state: VacanciesScreenState; readonly fromRegions: boolean } {
  if (hasManualLocation(state)) return { state, fromRegions: false };
  const regions = state.regions.length ? state.regions : campaignRegions;
  const keys = countryKeysForRegions(tree, places, regions);
  if (!keys.length) return { state, fromRegions: false };
  return { state: { ...state, selectedLocations: keys }, fromRegions: true };
}

/** «Выбрано 47» в макете — вакансии, а не число отмеченных строк. */
export function selectedLocationVacancies(tree: LocationTree, state: VacanciesScreenState): number {
  const selected = state.selectedLocations ?? [];
  const inCountries = tree.countries.reduce(
    (sum, node) => sum + selectedVacancyCount(node, selected),
    0,
  );
  return inCountries + (state.locationRemote ? tree.remote : 0);
}
