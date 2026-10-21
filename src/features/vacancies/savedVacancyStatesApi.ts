import { apiFetch, readData } from '../coach/apiClient';
import type { SavedVacancyState } from './savedVacanciesView';

export interface SavedVacancyRef {
  readonly clusterId: string;
  readonly url?: string;
}

/**
 * B550: деньги, закрытие, уровень и гео сохранённых вакансий. Сервер ищет
 * каждую в каталоге по id кластера, иначе по URL.
 */
export async function getSavedVacancyStates(
  items: readonly SavedVacancyRef[],
  signal?: AbortSignal,
): Promise<Readonly<Record<string, SavedVacancyState>>> {
  if (!items.length) return {};
  const response = await apiFetch('/api/v1/candidate/saved-vacancy-states', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: items.slice(0, 100) }),
    signal,
  });
  return (await readData<Record<string, SavedVacancyState>>(response)) ?? {};
}
