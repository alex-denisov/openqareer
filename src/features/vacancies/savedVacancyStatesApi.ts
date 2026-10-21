import { apiFetch, readData } from '../coach/apiClient';
import type { SavedVacancyState } from './savedVacanciesView';

/** B550: деньги и закрытие на площадке для сохранённых вакансий (по id кластера). */
export async function getSavedVacancyStates(
  clusterIds: readonly string[],
  signal?: AbortSignal,
): Promise<Readonly<Record<string, SavedVacancyState>>> {
  if (!clusterIds.length) return {};
  const query = new URLSearchParams({ ids: clusterIds.slice(0, 100).join(',') });
  const response = await apiFetch(`/api/v1/candidate/saved-vacancy-states?${query.toString()}`, {
    signal,
  });
  return (await readData<Record<string, SavedVacancyState>>(response)) ?? {};
}
