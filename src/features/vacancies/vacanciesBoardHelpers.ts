import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { CampaignMetaView } from '../coach/matchedVacancyApi';
import { sortVacancyFitItems } from './VacancyFitSort';
import type { VacanciesScreenState } from './vacanciesScreenState';
import { filterByScreenState } from './vacancyScreenCriteria';
import { countActiveFilters } from './VacanciesScreenFilters';

/** Pure helpers of the «Вакансии» board, kept out of the screen file (size limit). */
export function extractBoardRegions(campaign?: CampaignMetaView) {
  const isProfile = campaign?.regions.origin === 'profile';
  return {
    roles: campaign?.roles.value ?? [],
    careerLocations: campaign?.careerGeography,
    regions: isProfile ? [] : (campaign?.regions.value ?? []),
    suggestedRegions: campaign?.suggestedRegions?.length
      ? campaign.suggestedRegions
      : isProfile
        ? (campaign?.regions.value ?? [])
        : [],
  };
}

export function initialSelectedId(matched: readonly MatchedVacancyItem[]): string | undefined {
  // B549: on a narrow screen a selected row opens a push screen; nothing is preselected.
  if (typeof window !== 'undefined' && window.innerWidth > 760) {
    return matched[0]?.cluster.id;
  }
  return undefined;
}

export function filterBoardVacancies(
  matched: readonly MatchedVacancyItem[],
  state: VacanciesScreenState,
  now: string,
  onFiltersChange?: unknown,
) {
  const filters = onFiltersChange ? { ...state, roles: [], regions: [], remoteOnly: false } : state;
  const items = filterByScreenState(matched, filters, now);
  return onFiltersChange ? items : sortVacancyFitItems(items, state.sort);
}

/** The count the board shows: local while client-side filters narrow a complete pool. */
export function screenFilteredCount(
  input: {
    readonly onFiltersChange?: unknown;
    readonly poolComplete?: boolean;
    readonly total?: number;
  },
  localCount: number,
  state: Parameters<typeof countActiveFilters>[0],
): number {
  // Salary is filtered only here, never by the server (B546): its count is local.
  const salaryFilter = state.salaryMinimum !== undefined || state.salaryMaximum !== undefined;
  const hasClientFilters =
    state.selectedCity !== undefined ||
    Boolean(state.selectedCities?.length) ||
    salaryFilter ||
    Boolean(state.companyName) ||
    // B446-r: при серверной подборке локации фильтрует сервер, его число и верно.
    (!input.onFiltersChange && Boolean(state.selectedLocations?.length || state.locationRemote)) ||
    (!input.onFiltersChange && countActiveFilters(state) > 0);
  if (hasClientFilters && input.poolComplete !== false) return localCount;
  return input.total ?? localCount;
}
