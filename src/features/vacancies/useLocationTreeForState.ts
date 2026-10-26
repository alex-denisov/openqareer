import { useCallback } from 'react';

import { buildLocationTree, type LocationTree } from '../../../shared/locationTree';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { useGeoDirectory } from '../geo/useGeoDirectory';
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
  // Справочник приходит отдельным чанком: после загрузки дерево строится заново.
  const { ready: directoryReady } = useGeoDirectory();
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
    [matched, serverFiltered, directoryReady],
  );
}

const SERVER_KEYS = [
  'roles',
  'regions',
  'levels',
  'sources',
  'remoteOnly',
  'selectedLocations',
  'locationRemote',
  'sort',
] as const;

/**
 * Число «Показать N» листа фильтров 390 (B547, B446-r). Черновик без правок —
 * число выдачи с экрана (одно на шапку, вкладку и подвал). Правки серверных
 * условий до перезапроса не известны — `undefined`, без выдуманной цифры;
 * клиентские (деньги, формат) считаются по пулу, только если он прочитан целиком.
 */
export function useResultCountBuilder(
  matched: readonly MatchedVacancyItem[],
  applied: VacanciesScreenState,
  serverFiltered: boolean,
  appliedTotal?: number,
  poolComplete = true,
): (state: VacanciesScreenState) => number | undefined {
  return useCallback(
    (state) => {
      if (appliedTotal !== undefined && JSON.stringify(state) === JSON.stringify(applied)) {
        return appliedTotal;
      }
      const serverChanged = SERVER_KEYS.some(
        (key) => JSON.stringify(state[key] ?? null) !== JSON.stringify(applied[key] ?? null),
      );
      if (serverFiltered && serverChanged) return undefined;
      if (!poolComplete) return undefined;
      const filters = serverFiltered
        ? {
            ...state,
            roles: [],
            regions: [],
            sources: [],
            remoteOnly: false,
            selectedLocations: [],
            locationRemote: false,
          }
        : state;
      return filterByScreenState(matched, filters, '').length;
    },
    [matched, applied, serverFiltered, appliedTotal, poolComplete],
  );
}
