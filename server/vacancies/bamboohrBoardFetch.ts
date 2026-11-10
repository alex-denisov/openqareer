import { mapWithConcurrency } from './boundedConcurrency';
import { withRequestTimeout } from './requestTimeout';

/**
 * B628: список BambooHR (`/careers/list`) не несёт даты публикации, а без неё
 * фильтр свежести отбрасывает все вакансии доски (прод 10.11: 2 доски, 0 в
 * пуле при 5 и 13 в ленте). Дата берётся из карточки `/careers/<id>/detail`.
 */
const BAMBOOHR_TIMEOUT_MS = 45_000;
const DETAIL_CONCURRENCY = 4;

type Fetch = typeof fetch;

async function getJson(fetchImpl: Fetch, url: string): Promise<unknown> {
  return withRequestTimeout(BAMBOOHR_TIMEOUT_MS, async (signal) => {
    const res = await fetchImpl(url, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`vacancy_source_unreachable: ${res.status}`);
    return res.json() as Promise<unknown>;
  });
}

function datePostedOf(detail: unknown): string | undefined {
  const opening = (detail as { result?: { jobOpening?: { datePosted?: unknown } } })?.result
    ?.jobOpening;
  return typeof opening?.datePosted === 'string' ? opening.datePosted : undefined;
}

/** Лента доски с датой публикации в каждой записи; карточка без ответа даты не даёт. */
export async function fetchBamboohrBoard(
  board: string,
  fetchImpl: Fetch = fetch,
): Promise<unknown> {
  const list = (await getJson(fetchImpl, `https://${board}.bamboohr.com/careers/list`)) as {
    result?: unknown;
  };
  const items = Array.isArray(list?.result) ? (list.result as Record<string, unknown>[]) : [];
  const dated = await mapWithConcurrency(items, DETAIL_CONCURRENCY, async (item) => {
    const id = typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id) : '';
    if (!id) return item;
    try {
      const detail = await getJson(fetchImpl, `https://${board}.bamboohr.com/careers/${id}/detail`);
      return { ...item, datePosted: datePostedOf(detail) };
    } catch {
      return item;
    }
  });
  return { ...list, result: dated };
}
