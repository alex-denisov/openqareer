import { useMemo } from 'react';

import { buildLocationTree, type LocationTree } from '../../../shared/locationTree';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { VacanciesScreenState } from './vacanciesScreenState';
import { filterByScreenState } from './vacancyScreenCriteria';

/**
 * Счётчики «Локаций» (B547) — по той же выдаче, что покажет список, но без
 * самого фильтра локаций: число в узле совпадает со списком после «Применить».
 * Серверные фильтры (роли, регионы, удалёнка) при серверной подборке уже
 * применены к `matched`, как и в `filterBoardVacancies`.
 */
export function useLocationTreeForState(
  matched: readonly MatchedVacancyItem[],
  state: VacanciesScreenState,
  serverFiltered: boolean,
): LocationTree {
  return useMemo(() => {
    const withoutLocation: VacanciesScreenState = {
      ...state,
      ...(serverFiltered ? { roles: [], regions: [], remoteOnly: false } : {}),
      selectedLocations: [],
      locationRemote: false,
      locationSearch: '',
      selectedCity: undefined,
    };
    return buildLocationTree(
      filterByScreenState(matched, withoutLocation, '').map((item) => ({
        location: item.cluster.canonicalLocation,
        country: item.cluster.companyFeatures?.country,
        isRemote: item.cluster.isRemote,
      })),
    );
  }, [matched, state, serverFiltered]);
}
