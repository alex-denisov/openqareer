import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { CampaignMetaView } from '../coach/matchedVacancyApi';
import { sortVacancyFitItems } from './VacancyFitSort';
import type { VacanciesScreenState } from './vacanciesScreenState';
import { filterByScreenState } from './vacancyScreenCriteria';

/** Pure helpers of the «Вакансии» board, kept out of the screen file (size limit). */
export function extractBoardRegions(campaign?: CampaignMetaView) {
  const isProfile = campaign?.regions.origin === 'profile';
  return {
    roles: campaign?.roles.value ?? [],
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
