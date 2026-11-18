import type { OwnVacancy, OwnVacancyCreateResult, OwnVacancyDetail } from '../../../../shared/b640OwnVacancy';
import { apiFetch, malformedResponseError, readDataArray, readDataObject, throwApiError } from '../../coach/apiClient';

/** B676: своя вакансия кандидата — по ссылке или тексту; видна только ему. */
const BASE = '/api/v1/candidate/b640/own-vacancies';

export type OwnVacancySource = { readonly link: string } | { readonly text: string };

/** Одна строка без пробелов с http(s) — ссылка; всё остальное — текст вакансии. */
export function ownVacancySource(value: string): OwnVacancySource {
  const trimmed = value.trim();
  return /^https?:\/\/\S+$/iu.test(trimmed) ? { link: trimmed } : { text: trimmed };
}

function isOwnVacancy(value: unknown): value is OwnVacancy {
  const data = value as Partial<OwnVacancy>;
  return typeof data?.id === 'string' && typeof data.title === 'string';
}

function isCreateResult(value: unknown): value is OwnVacancyCreateResult {
  const data = value as Partial<OwnVacancyCreateResult> & { vacancy?: unknown };
  if (data.outcome === 'created') return isOwnVacancy(data.vacancy);
  return ['in_pool', 'unreadable', 'limit'].includes(String(data.outcome));
}

export async function createOwnVacancy(source: OwnVacancySource, signal?: AbortSignal): Promise<OwnVacancyCreateResult> {
  const response = await apiFetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(source),
    signal,
  });
  const data = await readDataObject<OwnVacancyCreateResult>(response);
  if (!isCreateResult(data)) throw malformedResponseError();
  return data;
}

export async function listOwnVacancies(signal?: AbortSignal): Promise<readonly OwnVacancy[]> {
  const data = await readDataArray<OwnVacancy>(await apiFetch(BASE, { signal }));
  if (!data.every(isOwnVacancy)) throw malformedResponseError();
  return data;
}

export async function getOwnVacancy(id: string, signal?: AbortSignal): Promise<OwnVacancyDetail> {
  const data = await readDataObject<OwnVacancyDetail>(await apiFetch(`${BASE}/${encodeURIComponent(id)}`, { signal }));
  if (!isOwnVacancy(data) || typeof data.text !== 'string') throw malformedResponseError();
  return data;
}

export async function deleteOwnVacancy(id: string): Promise<void> {
  const response = await apiFetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) await throwApiError(response);
}
