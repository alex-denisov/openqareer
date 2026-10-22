import { useCallback } from 'react';

import { buildLocationTree, type LocationTree } from '../../../shared/locationTree';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { VacanciesScreenState } from './vacanciesScreenState';
import { filterByScreenState } from './vacancyScreenCriteria';

export type LocationTreeBuilder = (state: VacanciesScreenState) => LocationTree;

/**
 * Счётчики «Локаций» (B547) — по той же выдаче, что покажет список после
 * «Применить» черновика фильтров, но без самого фильтра локаций. Серверные
 * фильтры (роли, регионы, удалёнка) при серверной подборке уже применены к
 * `matched`, как и в `filterBoardVacancies`.
 */
export function useLocationTreeBuilder(
  matched: readonly MatchedVacancyItem[],
  serverFiltered: boolean,
): LocationTreeBuilder {
  return useCallback(
    (state) => {
      const withoutLocation: VacanciesScreenState = {
        ...state,
        ...(serverFiltered ? { roles: [], regions: [], remoteOnly: false } : {}),
        selectedLocations: [],
        locationRemote: false,
        locationSearch: '',
        selectedCity: undefined,
        selectedCities: [],
      };
      return buildLocationTree(
        filterByScreenState(matched, withoutLocation, '').map((item) => ({
          location: item.cluster.canonicalLocation,
          country: item.cluster.companyFeatures?.country,
          isRemote: item.cluster.isRemote,
        })),
      );
    },
    [matched, serverFiltered],
  );
}

const SERVER_KEYS = ['roles', 'regions', 'levels', 'remoteOnly', 'sort'] as const;

/**
 * Число «Показать N» листа фильтров 390 (B547): та же клиентская фильтрация,
 * что у списка. Если черновик меняет серверные условия подборки, число до
 * перезапроса неизвестно — `undefined`, без выдуманной цифры.
 */
export function useResultCountBuilder(
  matched: readonly MatchedVacancyItem[],
  applied: VacanciesScreenState,
  serverFiltered: boolean,
): (state: VacanciesScreenState) => number | undefined {
  return useCallback(
    (state) => {
      const serverChanged = SERVER_KEYS.some(
        (key) => JSON.stringify(state[key] ?? null) !== JSON.stringify(applied[key] ?? null),
      );
      if (serverFiltered && serverChanged) return undefined;
      const filters = serverFiltered
        ? { ...state, roles: [], regions: [], remoteOnly: false }
        : state;
      return filterByScreenState(matched, filters, '').length;
    },
    [matched, applied, serverFiltered],
  );
}
