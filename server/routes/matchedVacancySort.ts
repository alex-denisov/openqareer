import { DEFAULT_VACANCY_SORT, type VacancySort } from '../../shared/vacancySort';
import {
  matchedVacanciesQuerySchema,
  type MatchedVacancyFilters,
} from '../vacancies/matchedVacancyFilters';
import type { RouteDeps } from './deps';

/**
 * Owner 29.10: the header sort is remembered per account on the server. A request that names a
 * sort saves it; one that does not reads the saved choice, «Совпадение» descending by default.
 */
export function resolveVacancySort(
  deps: Pick<RouteDeps, 'candidateStore'>,
  candidateId: string,
  filters: Pick<MatchedVacancyFilters, 'sort' | 'dir'>,
): VacancySort {
  const workspace = deps.candidateStore.getCandidateWorkspace(candidateId);
  const saved = workspace?.vacancySort ?? DEFAULT_VACANCY_SORT;
  if (!filters.sort) return saved;
  const chosen: VacancySort = { by: filters.sort, dir: filters.dir ?? 'desc' };
  if (workspace && (chosen.by !== saved.by || chosen.dir !== saved.dir)) {
    deps.candidateStore.saveCandidateWorkspace(candidateId, { ...workspace, vacancySort: chosen });
  }
  return chosen;
}

/** The query filters with the effective sort, so the list cache key never reuses another order. */
export function readSortedFilters(
  deps: Pick<RouteDeps, 'candidateStore'>,
  candidateId: string,
  query: unknown,
): { readonly filters: MatchedVacancyFilters; readonly sort: VacancySort } {
  const parsed = matchedVacanciesQuerySchema.parse(query);
  const sort = resolveVacancySort(deps, candidateId, parsed);
  return { filters: { ...parsed, sort: sort.by, dir: sort.dir }, sort };
}
