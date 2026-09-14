import { record, numeric, asArray, text } from './jsonVacancyRecord';
import { WORKDAY_SOURCE_PREFIX } from './workdayBoardSources';

/**
 * Постраничные JSON-площадки (B215).
 *
 * Одна страница — это не источник. У TheMuse 120 000 вакансий на 6 000
 * страницах, у Himalayas 100 000 за курсором, у Amazon 10 000 через смещение,
 * у Workday — по 20 записей на запрос. Читать одну страницу и называть это
 * «опросом площадки» — та самая пустая витрина, которую запрещает B161.
 *
 * ПОЧЕМУ БЮДЖЕТ, А НЕ «ДО КОНЦА». Полный проход TheMuse — шесть тысяч
 * обращений за один опрос. Вместо этого каждый опрос читает ограниченное число
 * страниц, а незаконченное чтение честно называет себя частичным: движок
 * дополняет срез, а не заменяет его (см. `partial` в multiSourceVacancyEngine).
 *
 * ПОЧЕМУ ОКНО СДВИГАЕТСЯ ОТ ВРЕМЕНИ. У площадок без сортировки по дате
 * (TheMuse) один и тот же первый десяток страниц читался бы каждый опрос, а
 * остальные — никогда. Окно, вычисленное из текущего времени, обходит весь
 * диапазон по кругу и не требует хранить курсор между перезапусками.
 */

export interface PagedRequest {
  readonly url: string;
  readonly method?: 'GET' | 'POST';
  readonly body?: unknown;
}

export interface PagingPlan {
  /** Сколько страниц читает один опрос. */
  readonly pagesPerSync: number;
  /** Пауза между страницами: площадка не должна видеть очередь. */
  readonly delayMs: number;
  first(targetUrl: string, nowMs: number): PagedRequest;
  /** Следующая страница или `null`, когда площадка отдала всё. */
  next(previous: PagedRequest, payload: unknown): PagedRequest | null;
}

const WORKDAY_PAGE = 20;

/** Сдвинуть окно из `pagesPerSync` страниц по кругу от текущего времени. */
export function rotatingWindowStart(
  nowMs: number,
  intervalMinutes: number,
  pagesPerSync: number,
  totalPages: number,
): number {
  const windows = Math.max(1, Math.ceil(totalPages / pagesPerSync));
  const tick = Math.floor(nowMs / (intervalMinutes * 60_000));
  return (tick % windows) * pagesPerSync + 1;
}

function withParam(url: string, name: string, value: string): string {
  const next = new URL(url);
  next.searchParams.set(name, value);
  return next.toString();
}

function pageOf(url: string, name: string): number {
  return numeric(new URL(url).searchParams.get(name) ?? undefined) ?? 0;
}

/**
 * TheMuse: `page` от 1, `page_count` в ответе. Сортировки по дате у API нет,
 * поэтому окно вращается. Оценка страниц для вращения — из самого ответа не
 * взять до первого запроса, поэтому используется последняя замеренная
 * величина; переоценка безвредна: пустая страница завершает чтение.
 */
const THEMUSE_PAGES_ESTIMATE = 10_000;
const THEMUSE_PAGES_PER_SYNC = 60;
const THEMUSE_INTERVAL_MINUTES = 60;

const themuse: PagingPlan = {
  pagesPerSync: THEMUSE_PAGES_PER_SYNC,
  delayMs: 400,
  first: (targetUrl, nowMs) => ({
    url: withParam(
      targetUrl,
      'page',
      String(
        rotatingWindowStart(
          nowMs,
          THEMUSE_INTERVAL_MINUTES,
          THEMUSE_PAGES_PER_SYNC,
          THEMUSE_PAGES_ESTIMATE,
        ),
      ),
    ),
  }),
  next: (previous, payload) => {
    const page = pageOf(previous.url, 'page');
    const pageCount = numeric(record(payload).page_count) ?? 0;
    const results = asArray(record(payload).results) ?? [];
    if (results.length === 0 || page >= pageCount) return null;
    return { url: withParam(previous.url, 'page', String(page + 1)) };
  },
};

/** Himalayas: курсор `nextCursor`, выдача от свежих к старым. */
const himalayas: PagingPlan = {
  pagesPerSync: 25,
  delayMs: 300,
  first: (targetUrl) => ({ url: targetUrl }),
  next: (previous, payload) => {
    const cursor = text(record(payload).nextCursor);
    const jobs = asArray(record(payload).jobs) ?? [];
    if (!cursor || jobs.length === 0) return null;
    return { url: withParam(previous.url, 'cursor', cursor) };
  },
};

/** Amazon.jobs: `offset`/`result_limit`, `hits` — общее число (площадка режет на 10 000). */
const amazon: PagingPlan = {
  pagesPerSync: 20,
  delayMs: 500,
  first: (targetUrl) => ({ url: withParam(targetUrl, 'offset', '0') }),
  next: (previous, payload) => {
    const offset = pageOf(previous.url, 'offset');
    const limit = pageOf(previous.url, 'result_limit') || 100;
    const hits = numeric(record(payload).hits) ?? 0;
    const jobs = asArray(record(payload).jobs) ?? [];
    if (jobs.length === 0 || offset + limit >= hits) return null;
    return { url: withParam(previous.url, 'offset', String(offset + limit)) };
  },
};

/** Eightfold (Netflix): `start`/`num`, `count` — общее число, `num` не больше 10. */
const eightfold: PagingPlan = {
  pagesPerSync: 60,
  delayMs: 300,
  first: (targetUrl) => ({ url: withParam(targetUrl, 'start', '0') }),
  next: (previous, payload) => {
    const start = pageOf(previous.url, 'start');
    const num = pageOf(previous.url, 'num') || 10;
    const count = numeric(record(payload).count) ?? 0;
    const positions = asArray(record(payload).positions) ?? [];
    if (positions.length === 0 || start + num >= count) return null;
    return { url: withParam(previous.url, 'start', String(start + num)) };
  },
};

/** Workday: POST с `offset`/`limit` (не больше 20), `total` в ответе. */
function workdayBody(offset: number): unknown {
  return { appliedFacets: {}, limit: WORKDAY_PAGE, offset, searchText: '' };
}

const workday: PagingPlan = {
  pagesPerSync: 100,
  delayMs: 400,
  first: (targetUrl) => ({ url: targetUrl, method: 'POST', body: workdayBody(0) }),
  next: (previous, payload) => {
    const offset = numeric(record(previous.body).offset) ?? 0;
    const total = numeric(record(payload).total) ?? 0;
    const postings = asArray(record(payload).jobPostings) ?? [];
    if (postings.length === 0 || offset + WORKDAY_PAGE >= total) return null;
    return { url: previous.url, method: 'POST', body: workdayBody(offset + WORKDAY_PAGE) };
  },
};

const PLANS: Readonly<Record<string, PagingPlan>> = {
  'src-themuse': themuse,
  'src-himalayas-api': himalayas,
  'src-amazon-jobs': amazon,
  'src-netflix': eightfold,
};

export function pagingPlanFor(sourceId: string): PagingPlan | null {
  if (sourceId.startsWith(WORKDAY_SOURCE_PREFIX)) return workday;
  return PLANS[sourceId] ?? null;
}

export function isWorkdaySource(sourceId: string): boolean {
  return sourceId.startsWith(WORKDAY_SOURCE_PREFIX);
}
