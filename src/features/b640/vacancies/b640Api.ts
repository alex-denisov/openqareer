import type { B640ApplicationQuota, B640HiddenInfo, B640SortKey } from '../../../../shared/b640Vacancies';
import type { MatchedVacancyItem } from '../../coach/cabinetTypes';
import { apiFetch, malformedResponseError, readDataObject, throwApiError } from '../../coach/apiClient';
import { matchedVacancyQuery } from '../../coach/matchedVacancyApi';
import type { SortKey, SortState } from './list/sortModel';

const BASE = '/api/v1/candidate/b640';
export const B640_PAGE_SIZE = 20;

export interface PageResult<T> {
  readonly rows: readonly T[];
  readonly total: number;
  readonly nextOffset: number | null;
}

export type HiddenRow = MatchedVacancyItem & { readonly hidden: B640HiddenInfo };

const SERVER_KEY: Readonly<Record<SortKey, B640SortKey>> = {
  fit: 'fit',
  money: 'money',
  role: 'role',
  company: 'company',
  geo: 'location',
  format: 'format',
  date: 'date',
};

/** Ответ `{ data: [...], meta }`: список и границы порции, чужая форма — ошибка. */
async function readPage<T>(response: Response): Promise<PageResult<T>> {
  if (!response.ok) await throwApiError(response);
  let envelope: { data?: unknown; meta?: { total?: unknown; nextOffset?: unknown } };
  try {
    envelope = (await response.json()) as typeof envelope;
  } catch {
    throw malformedResponseError();
  }
  if (!Array.isArray(envelope.data)) throw malformedResponseError();
  const rows = envelope.data as T[];
  const { total, nextOffset } = envelope.meta ?? {};
  return {
    rows,
    total: typeof total === 'number' ? total : rows.length,
    nextOffset: typeof nextOffset === 'number' ? nextOffset : null,
  };
}

/** Скрытые вакансии, новые первыми, порциями по 20. */
export async function getHiddenVacancies(offset: number, signal?: AbortSignal): Promise<PageResult<HiddenRow>> {
  const response = await apiFetch(`${BASE}/hidden-vacancies?offset=${offset}&limit=${B640_PAGE_SIZE}`, { signal });
  return readPage<HiddenRow>(response);
}

/** Запрос порции подборки: прежние фильтры (роли), `sort`, `direction`, `offset`, `limit`. */
export function matchedPageQuery(sort: SortState, roles: readonly string[], offset: number): string {
  const query = new URLSearchParams(matchedVacancyQuery(offset, { roles, regions: [], remoteOnly: false }));
  query.set('sort', SERVER_KEY[sort.key]);
  query.set('direction', sort.dir);
  query.set('limit', String(B640_PAGE_SIZE));
  return query.toString();
}

export async function getSortedMatchedPage(
  sort: SortState,
  roles: readonly string[],
  offset: number,
  signal?: AbortSignal,
): Promise<PageResult<MatchedVacancyItem>> {
  const response = await apiFetch(`${BASE}/matched-vacancies?${matchedPageQuery(sort, roles, offset)}`, { signal });
  return readPage<MatchedVacancyItem>(response);
}

export async function getApplicationQuota(signal?: AbortSignal): Promise<B640ApplicationQuota> {
  return readDataObject<B640ApplicationQuota>(await apiFetch(`${BASE}/application-quota`, { signal }));
}
