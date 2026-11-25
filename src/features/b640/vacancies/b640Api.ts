import type { B640ApplicationQuota, B640HiddenInfo, B640SortKey } from '../../../../shared/b640Vacancies';
import type { ApplyTarget } from '../../../../shared/applyTarget';
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

/** Фильтры списка, которые знает сервер (роли), строкой запроса: по ней сервер разбирает всю подборку. */
export function poolFilterQuery(roles: readonly string[]): string {
  const query = new URLSearchParams(matchedVacancyQuery(0, { roles, regions: [], remoteOnly: false }));
  query.delete('offset');
  return query.toString();
}

/** Запрос порции подборки: прежние фильтры (роли), `sort`, `direction`, `offset`, `limit`. */
/** Пояс кандидата для границы дня фильтра «Дата» — та же, что у числа роли «Карьеры». */
function candidateTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** `days` — фильтр «Дата» (B726): сервер режет и считает подборку сам; `null` — без даты. */
/** «Зарплата от» для сервера (B765): сумма в месяц в валюте фильтра. */
export interface ServerMoney {
  readonly from: number;
  readonly currency: 'RUB' | 'USD' | 'EUR' | 'AED';
}

export function matchedPageQuery(
  sort: SortState,
  roles: readonly string[],
  offset: number,
  days: number | null = null,
  money: ServerMoney | null = null,
): string {
  const query = new URLSearchParams(matchedVacancyQuery(offset, { roles, regions: [], remoteOnly: false }));
  query.set('sort', SERVER_KEY[sort.key]);
  query.set('direction', sort.dir);
  query.set('limit', String(B640_PAGE_SIZE));
  // Граница дня нужна и порядку «Даты».
  if (days !== null || sort.key === 'date') query.set('tz', candidateTimeZone());
  if (days !== null) query.set('days', String(days));
  if (money !== null) {
    query.set('money', String(money.from));
    query.set('moneyCurrency', money.currency);
  }
  return query.toString();
}

export async function getSortedMatchedPage(
  sort: SortState,
  roles: readonly string[],
  offset: number,
  signal?: AbortSignal,
  days: number | null = null,
  money: ServerMoney | null = null,
): Promise<PageResult<MatchedVacancyItem>> {
  const response = await apiFetch(`${BASE}/matched-vacancies?${matchedPageQuery(sort, roles, offset, days, money)}`, {
    signal,
  });
  return readPage<MatchedVacancyItem>(response);
}

export async function getApplicationQuota(signal?: AbortSignal): Promise<B640ApplicationQuota> {
  return readDataObject<B640ApplicationQuota>(await apiFetch(`${BASE}/application-quota`, { signal }));
}

/** B715: одна вакансия пула для карточки v04, когда её нет в загруженной подборке. */
export async function getVacancyCard(vacancyId: string, signal?: AbortSignal): Promise<MatchedVacancyItem> {
  const data = await readDataObject<MatchedVacancyItem>(
    await apiFetch(`${BASE}/vacancies/${encodeURIComponent(vacancyId)}`, { signal }),
  );
  if (typeof data.cluster?.id !== 'string' || !data.explanation) throw malformedResponseError();
  return data;
}

/** B787: раскрыть адрес трекера, когда кандидат открыл отклик. */
export async function postApplyTarget(
  vacancyId: string,
  signal?: AbortSignal,
): Promise<ApplyTarget | null> {
  const data = await readDataObject<{ applyTarget?: ApplyTarget | null }>(
    await apiFetch(`${BASE}/vacancies/${encodeURIComponent(vacancyId)}/apply-target`, {
      method: 'POST',
      signal,
    }),
  );
  return data.applyTarget ?? null;
}
