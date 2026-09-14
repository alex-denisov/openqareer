import { record, numeric, asArray, text } from './jsonVacancyRecord';
import { WORKDAY_SOURCE_PREFIX } from './workdayBoardSources';

/**
 * Постраничные JSON-площадки (B216).
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
  /** Состояние обхода между страницами; площадке не отправляется. */
  readonly state?: unknown;
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
 * TheMuse: `page` от 1, но не больше 99 — площадка отвечает `400 Value page is
 * too high` (замер с прод-VM 2026-09-14). Значит один фильтр отдаёт не больше
 * 1 980 записей, а категория «Software Engineering» одна держит 120 000.
 * Поэтому выдача дробится веером «категория × уровень», и каждый опрос читает
 * очередные комбинации по кругу от времени; сортировки по дате у API нет.
 */
const THEMUSE_MAX_PAGE = 99;
const THEMUSE_LEVELS = ['Internship', 'Entry Level', 'Mid Level', 'Senior Level', 'Management'];
const THEMUSE_PAGES_PER_SYNC = 200;
const THEMUSE_INTERVAL_MINUTES = 30;

interface ThemuseQuery {
  readonly category: string;
  readonly level: string;
}

export function themuseQueries(targetUrl: string): ThemuseQuery[] {
  const categories = new URL(targetUrl).searchParams.getAll('category');
  return categories.flatMap((category) => THEMUSE_LEVELS.map((level) => ({ category, level })));
}

function themuseUrl(targetUrl: string, query: ThemuseQuery, page: number): string {
  const url = new URL(targetUrl);
  url.searchParams.delete('category');
  url.searchParams.set('category', query.category);
  url.searchParams.set('level', query.level);
  url.searchParams.set('page', String(page));
  return url.toString();
}

const themuse: PagingPlan = {
  pagesPerSync: THEMUSE_PAGES_PER_SYNC,
  delayMs: 400,
  first: (targetUrl, nowMs) => {
    const queries = themuseQueries(targetUrl);
    const tick = Math.floor(nowMs / (THEMUSE_INTERVAL_MINUTES * 60_000));
    const query = queries[tick % Math.max(1, queries.length)];
    if (!query) return { url: targetUrl };
    return {
      url: themuseUrl(targetUrl, query, 1),
      state: { targetUrl, index: tick % queries.length },
    };
  },
  next: (previous, payload) => {
    const state = record(previous.state);
    const targetUrl = text(state.targetUrl);
    const queries = targetUrl ? themuseQueries(targetUrl) : [];
    if (queries.length === 0) return null;
    const page = pageOf(previous.url, 'page');
    const pageCount = Math.min(numeric(record(payload).page_count) ?? 0, THEMUSE_MAX_PAGE);
    const results = asArray(record(payload).results) ?? [];
    const index = numeric(state.index) ?? 0;
    if (results.length > 0 && page < pageCount) {
      return { url: themuseUrl(targetUrl, queries[index]!, page + 1), state: previous.state };
    }
    // Комбинация дочитана — следующая по кругу; бюджет страниц остановит опрос.
    const nextIndex = (index + 1) % queries.length;
    return {
      url: themuseUrl(targetUrl, queries[nextIndex]!, 1),
      state: { targetUrl, index: nextIndex },
    };
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

/**
 * Eightfold: `start`/`num`, `count` — общее число, `num` не больше 10. Netflix
 * отдаёт поля в корне, Microsoft (`/api/pcsx/search`) — под `data` (B217).
 */
export function eightfoldPayload(payload: unknown): { count: number; positions: unknown[] } {
  const root = record(payload);
  const body = asArray(root.positions) ? root : record(root.data);
  return { count: numeric(body.count) ?? 0, positions: asArray(body.positions) ?? [] };
}

const eightfold: PagingPlan = {
  pagesPerSync: 60,
  delayMs: 300,
  first: (targetUrl) => ({ url: withParam(targetUrl, 'start', '0') }),
  next: (previous, payload) => {
    const start = pageOf(previous.url, 'start');
    const num = pageOf(previous.url, 'num') || 10;
    const { count, positions } = eightfoldPayload(payload);
    if (positions.length === 0 || start + num >= count) return null;
    return { url: withParam(previous.url, 'start', String(start + num)) };
  },
};

/**
 * Microsoft: 2 215 вакансий по 10 — 222 страницы, за один опрос читается
 * окно, и оно сдвигается по кругу от времени; за концом выдачи — снова начало,
 * так что чтение всегда частичное и срез дополняется (замер 2026-09-14).
 */
const MICROSOFT_PAGE = 10;
const MICROSOFT_PAGE_CEILING = 250;
const MICROSOFT_INTERVAL_MINUTES = 240;

const microsoft: PagingPlan = {
  pagesPerSync: 60,
  delayMs: 300,
  first: (targetUrl, nowMs) => {
    const page = rotatingWindowStart(nowMs, MICROSOFT_INTERVAL_MINUTES, 60, MICROSOFT_PAGE_CEILING);
    return { url: withParam(targetUrl, 'start', String((page - 1) * MICROSOFT_PAGE)) };
  },
  next: (previous, payload) => {
    const start = pageOf(previous.url, 'start');
    const num = pageOf(previous.url, 'num') || MICROSOFT_PAGE;
    const { count, positions } = eightfoldPayload(payload);
    if (positions.length === 0) return null;
    const nextStart = start + num >= count ? 0 : start + num;
    return { url: withParam(previous.url, 'start', String(nextStart)) };
  },
};

/**
 * Apple: POST с номером страницы по 20, `res.totalRecords` = 6 081 (305 страниц,
 * замер 2026-09-14). Без `format` в теле площадка отдаёт пустую выдачу. Окно
 * по кругу от времени; за последней страницей — первая.
 */
const APPLE_PAGE = 20;
const APPLE_PAGE_CEILING = 320;
const APPLE_PAGES_PER_SYNC = 40;
const APPLE_INTERVAL_MINUTES = 240;

function appleRequest(url: string, page: number): PagedRequest {
  return {
    url,
    method: 'POST',
    body: {
      query: '',
      filters: {},
      page,
      locale: 'en-us',
      sort: 'newest',
      format: { longDate: 'MMMM D, YYYY', mediumDate: 'MMM D, YYYY' },
    },
    state: { page },
  };
}

const apple: PagingPlan = {
  pagesPerSync: APPLE_PAGES_PER_SYNC,
  delayMs: 400,
  first: (targetUrl, nowMs) =>
    appleRequest(
      targetUrl,
      rotatingWindowStart(nowMs, APPLE_INTERVAL_MINUTES, APPLE_PAGES_PER_SYNC, APPLE_PAGE_CEILING),
    ),
  next: (previous, payload) => {
    const page = numeric(record(previous.state).page) ?? 1;
    const res = record(record(payload).res);
    const total = numeric(res.totalRecords) ?? 0;
    const results = asArray(res.searchResults) ?? [];
    if (results.length === 0) return null;
    const lastPage = Math.max(1, Math.ceil(total / APPLE_PAGE));
    return appleRequest(previous.url, page >= lastPage ? 1 : page + 1);
  },
};

/**
 * Get on Board: без строки поиска `/search/jobs` пуст, зато
 * `/categories/<id>/jobs` отдаёт всё по категории (замер 2026-09-14). Веер по
 * категориям по кругу, внутри — страницы по `meta.total_pages`.
 */
const GETONBRD_CATEGORIES = [
  'programming',
  'sysadmin-devops-qa',
  'data-science-analytics',
  'machine-learning-ai',
  'mobile-developer',
  'cybersecurity',
  'design-ux',
  'digital-marketing',
  'advertising-media',
  'sales',
  'innovation-agile',
  'operations-management',
  'technical-support',
  'customer-support',
  'hr',
  'education-coaching',
  'hardware-electronics',
  'other',
] as const;
const GETONBRD_INTERVAL_MINUTES = 180;

export function getonbrdCategories(): readonly string[] {
  return GETONBRD_CATEGORIES;
}

function getonbrdUrl(targetUrl: string, category: string, page: number): string {
  const next = new URL(targetUrl);
  next.pathname = `/api/v0/categories/${category}/jobs`;
  next.searchParams.set('page', String(page));
  return next.toString();
}

const getonbrd: PagingPlan = {
  pagesPerSync: 24,
  delayMs: 500,
  first: (targetUrl, nowMs) => {
    const tick = Math.floor(nowMs / (GETONBRD_INTERVAL_MINUTES * 60_000));
    const index = tick % GETONBRD_CATEGORIES.length;
    return { url: getonbrdUrl(targetUrl, GETONBRD_CATEGORIES[index]!, 1), state: { index } };
  },
  next: (previous, payload) => {
    const index = numeric(record(previous.state).index) ?? 0;
    const page = pageOf(previous.url, 'page') || 1;
    const totalPages = numeric(record(record(payload).meta).total_pages) ?? 0;
    const data = asArray(record(payload).data) ?? [];
    if (data.length > 0 && page < totalPages) {
      return { url: getonbrdUrl(previous.url, GETONBRD_CATEGORIES[index]!, page + 1), state: previous.state };
    }
    const nextIndex = (index + 1) % GETONBRD_CATEGORIES.length;
    return { url: getonbrdUrl(previous.url, GETONBRD_CATEGORIES[nextIndex]!, 1), state: { index: nextIndex } };
  },
};

/**
 * Workday: POST с `offset`/`limit` (не больше 20). `total` площадка называет
 * только на первой странице, дальше отдаёт 0 (замер NVIDIA 2026-09-14) —
 * поэтому он переносится в состояние обхода.
 */
function workdayRequest(url: string, offset: number, total: number): PagedRequest {
  return {
    url,
    method: 'POST',
    body: { appliedFacets: {}, limit: WORKDAY_PAGE, offset, searchText: '' },
    state: { offset, total },
  };
}

const workday: PagingPlan = {
  pagesPerSync: 100,
  delayMs: 400,
  first: (targetUrl) => workdayRequest(targetUrl, 0, 0),
  next: (previous, payload) => {
    const state = record(previous.state);
    const offset = numeric(state.offset) ?? 0;
    const total = Math.max(numeric(record(payload).total) ?? 0, numeric(state.total) ?? 0);
    const postings = asArray(record(payload).jobPostings) ?? [];
    if (postings.length < WORKDAY_PAGE || offset + WORKDAY_PAGE >= total) return null;
    return workdayRequest(previous.url, offset + WORKDAY_PAGE, total);
  },
};

const PLANS: Readonly<Record<string, PagingPlan>> = {
  'src-themuse': themuse,
  'src-himalayas-api': himalayas,
  'src-amazon-jobs': amazon,
  'src-netflix': eightfold,
  'src-microsoft-careers': microsoft,
  'src-apple-jobs': apple,
  'src-getonbrd': getonbrd,
};

export function pagingPlanFor(sourceId: string): PagingPlan | null {
  if (sourceId.startsWith(WORKDAY_SOURCE_PREFIX)) return workday;
  return PLANS[sourceId] ?? null;
}

export function isWorkdaySource(sourceId: string): boolean {
  return sourceId.startsWith(WORKDAY_SOURCE_PREFIX);
}
