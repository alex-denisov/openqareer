import { apiFetch, readData } from '../coach/apiClient';
import type { VacancyFitView } from '../../../shared/vacancyFit';
export async function readVacancyFit(
  vacancyId: string,
  signal?: AbortSignal,
): Promise<VacancyFitView> {
  return readData<VacancyFitView>(
    await apiFetch(`/api/v1/candidate/vacancies/${encodeURIComponent(vacancyId)}/fit`, { signal }),
  );
}
/** Queues the fit; the answer is the view right after queueing (202 → `processing`). */
export async function requestVacancyFit(vacancyId: string): Promise<VacancyFitView> {
  return readData<VacancyFitView>(
    await apiFetch(`/api/v1/candidate/vacancies/${encodeURIComponent(vacancyId)}/fit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),
  );
}
