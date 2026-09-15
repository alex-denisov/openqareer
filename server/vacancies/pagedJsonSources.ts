import { record, numeric, asArray, text } from './jsonVacancyRecord';
import {
  INDEED_GRAPHQL_URL,
  indeedHeaders,
  indeedQuery,
  naukriHeaders,
  bdjobsHeaders,
  ziprecruiterHeaders,
  GLASSDOOR_GRAPHQL_URL,
  glassdoorHeaders,
  glassdoorPayload,
} from './jobspyEndpoints';
import {
  BDJOBS_SOURCE_ID,
  NAUKRI_SOURCE_ID,
  ZIPRECRUITER_SOURCE_ID,
  GLASSDOOR_SOURCE_ID,
} from './jobspyAdapters';
import { FAN_SIZE, fanComboAt, fanStartIndex } from './jobspyFan';
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
  /** Заголовки, которые ставит именно эта площадка (ключ приложения Indeed). */
  readonly headers?: Readonly<Record<string, string>>;
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
 * Пул держит вакансии не старше 30 дней (`MAX_VACANCY_AGE_DAYS` движка).
 * У площадок с сортировкой от свежих читать окно по кругу бессмысленно: первый
 * опрос Apple на проде прочёл 800 записей 2023 года и не оставил ни одной
 * (2026-09-14). Такие площадки читаются с первой страницы до границы свежести —
 * и это полное чтение всего, что пул вообще примет.
 */
export const FRESHNESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function olderThanWindow(publishedMs: number | undefined, nowMs: number): boolean {
  return publishedMs !== undefined && nowMs - publishedMs > FRESHNESS_WINDOW_MS;
}

/**
 * Microsoft: 2 215 вакансий по 10, `sort_by=timestamp` — от свежих. Читается
 * с начала до границы свежести. Первый опрос на проде получил 429 на 60
 * страницах с паузой 300 мс — площадка считает запросы; пауза длиннее, бюджет
 * меньше (2026-09-14).
 */
const MICROSOFT_PAGE = 10;
const MICROSOFT_PAGES_PER_SYNC = 40;
const MICROSOFT_PAGE_CEILING = 250;
const MICROSOFT_INTERVAL_MINUTES = 240;

/**
 * Состояние окна по свежим страницам. Окно стартует не с начала, а по кругу от
 * времени: бюджет одного опроса — не потолок площадки, а порция; следующий
 * опрос продолжит с другой порции, и за несколько опросов прочитается всё
 * свежее. За границей свежести окно заворачивает на первую страницу и
 * останавливается, дойдя до своей стартовой — тогда чтение полное.
 */
interface FreshWindowState {
  readonly startPage: number;
  readonly startedAt: number;
  readonly wrapped: boolean;
}

function freshWindowNext(
  state: FreshWindowState,
  page: number,
  lastPage: number,
  oldestMs: number | undefined,
): { page: number; wrapped: boolean } | null {
  const edge = page >= lastPage || olderThanWindow(oldestMs, state.startedAt);
  if (!edge) {
    const next = page + 1;
    return state.wrapped && next >= state.startPage ? null : { page: next, wrapped: state.wrapped };
  }
  if (state.wrapped || state.startPage === 1) return null;
  return { page: 1, wrapped: true };
}

function microsoftRequest(url: string, page: number, state: FreshWindowState): PagedRequest {
  return { url: withParam(url, 'start', String((page - 1) * MICROSOFT_PAGE)), state };
}

const microsoft: PagingPlan = {
  pagesPerSync: MICROSOFT_PAGES_PER_SYNC,
  delayMs: 1_500,
  first: (targetUrl, nowMs) => {
    const startPage = rotatingWindowStart(
      nowMs,
      MICROSOFT_INTERVAL_MINUTES,
      MICROSOFT_PAGES_PER_SYNC,
      MICROSOFT_PAGE_CEILING,
    );
    return microsoftRequest(targetUrl, startPage, { startPage, startedAt: nowMs, wrapped: false });
  },
  next: (previous, payload) => {
    const state = previous.state as FreshWindowState;
    const page = Math.floor(pageOf(previous.url, 'start') / MICROSOFT_PAGE) + 1;
    const { count, positions } = eightfoldPayload(payload);
    if (positions.length === 0)
      return state.wrapped || state.startPage === 1
        ? null
        : microsoftRequest(previous.url, 1, { ...state, wrapped: true });
    const oldest = numeric(record(positions[positions.length - 1]).postedTs);
    const step = freshWindowNext(
      state,
      page,
      Math.ceil(count / MICROSOFT_PAGE),
      oldest === undefined ? undefined : oldest * 1000,
    );
    return step
      ? microsoftRequest(previous.url, step.page, { ...state, wrapped: step.wrapped })
      : null;
  },
};

/**
 * Apple: POST с номером страницы по 20, `res.totalRecords` = 6 081 (305 страниц,
 * замер 2026-09-14), `sort: newest`. Без `format` в теле площадка отдаёт пустую
 * выдачу. Читается с первой страницы до границы свежести.
 */
const APPLE_PAGE = 20;
const APPLE_PAGES_PER_SYNC = 100;
const APPLE_PAGE_CEILING = 320;
const APPLE_INTERVAL_MINUTES = 240;

function appleRequest(url: string, page: number, state: FreshWindowState): PagedRequest {
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
    state,
  };
}

const apple: PagingPlan = {
  pagesPerSync: APPLE_PAGES_PER_SYNC,
  delayMs: 400,
  first: (targetUrl, nowMs) => {
    const startPage = rotatingWindowStart(
      nowMs,
      APPLE_INTERVAL_MINUTES,
      APPLE_PAGES_PER_SYNC,
      APPLE_PAGE_CEILING,
    );
    return appleRequest(targetUrl, startPage, { startPage, startedAt: nowMs, wrapped: false });
  },
  next: (previous, payload) => {
    const state = previous.state as FreshWindowState;
    const page = numeric(record(previous.body).page) ?? 1;
    const res = record(record(payload).res);
    const total = numeric(res.totalRecords) ?? 0;
    const results = asArray(res.searchResults) ?? [];
    if (results.length === 0)
      return state.wrapped || state.startPage === 1
        ? null
        : appleRequest(previous.url, 1, { ...state, wrapped: true });
    const oldest = Date.parse(text(record(results[results.length - 1]).postDateInGMT));
    const step = freshWindowNext(
      state,
      page,
      Math.ceil(total / APPLE_PAGE),
      Number.isNaN(oldest) ? undefined : oldest,
    );
    return step ? appleRequest(previous.url, step.page, { ...state, wrapped: step.wrapped }) : null;
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
      return {
        url: getonbrdUrl(previous.url, GETONBRD_CATEGORIES[index]!, page + 1),
        state: previous.state,
      };
    }
    const nextIndex = (index + 1) % GETONBRD_CATEGORIES.length;
    return {
      url: getonbrdUrl(previous.url, GETONBRD_CATEGORIES[nextIndex]!, 1),
      state: { index: nextIndex },
    };
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

/**
 * Indeed: мобильный GraphQL `apis.indeed.com/graphql`, курсор `nextCursor`, по
 * 100 записей. Один запрос отдаёт не больше 968 записей — дальше курсора нет
 * (замер 2026-09-14), поэтому охват даёт веер «роль × рынок».
 *
 * ПОЧЕМУ У КОМБИНАЦИИ ПОТОЛОК СТРАНИЦ. Выдача идёт `sort: DATE`, то есть от
 * свежих. Дочитывать комбинацию до конца курсора значит уходить в вакансии,
 * которые пул всё равно отсеет по тридцатидневной свежести. Четыре страницы —
 * четыреста самых свежих по рынку — и опрос переходит к следующему рынку.
 * За то же время веер покрывает в разы больше рынков.
 */
const INDEED_COMBOS_PER_SYNC = 30;
const INDEED_PAGES_PER_COMBO = 4;
const INDEED_INTERVAL_MINUTES = 60;

interface IndeedState {
  readonly index: number;
  readonly startIndex: number;
  readonly page: number;
  readonly wrapped: boolean;
}

/** Ближайшая комбинация, которую Indeed вообще умеет читать (страна известна). */
function indeedComboFrom(
  index: number,
): { combo: ReturnType<typeof fanComboAt>; index: number } | null {
  for (let step = 0; step < FAN_SIZE; step += 1) {
    const at = (index + step) % FAN_SIZE;
    const combo = fanComboAt(at);
    if (combo.target.indeedCountry) return { combo, index: at };
  }
  // Ни одного рынка со страной Indeed — сбор невозможен, и молчать об этом
  // нельзя (B199).
  return null;
}

function indeedRequest(state: IndeedState, cursor: string | null): PagedRequest | null {
  const found = indeedComboFrom(state.index);
  if (!found) return null;
  const { combo, index } = found;
  return {
    url: INDEED_GRAPHQL_URL,
    method: 'POST',
    body: { query: indeedQuery(combo.term, cursor, combo.target.location) },
    headers: indeedHeaders(combo.target.indeedCountry!),
    state: { ...state, index },
  };
}

const indeed: PagingPlan = {
  pagesPerSync: INDEED_COMBOS_PER_SYNC * INDEED_PAGES_PER_COMBO,
  delayMs: 800,
  first: (_targetUrl, nowMs) => {
    const startIndex = fanStartIndex(nowMs, INDEED_INTERVAL_MINUTES, INDEED_COMBOS_PER_SYNC);
    const request = indeedRequest({ index: startIndex, startIndex, page: 1, wrapped: false }, null);
    if (!request) throw new Error('indeed_fan_has_no_country');
    return request;
  },
  next: (previous, payload) => {
    const state = previous.state as IndeedState;
    const search = record(record(record(payload).data).jobSearch);
    const cursor = text(record(search.pageInfo).nextCursor);
    const results = asArray(search.results) ?? [];
    // Внутри комбинации: есть курсор, есть записи и не выбран потолок страниц.
    if (cursor && results.length > 0 && state.page < INDEED_PAGES_PER_COMBO) {
      return indeedRequest({ ...state, page: state.page + 1 }, cursor);
    }
    // Комбинация закрыта — следующий рынок; полный круг означает, что веер
    // прочитан целиком.
    const nextIndex = (state.index + 1) % FAN_SIZE;
    const wrapped = state.wrapped || nextIndex === 0;
    if (wrapped && nextIndex === state.startIndex) return null;
    return indeedRequest(
      { index: nextIndex, startIndex: state.startIndex, page: 1, wrapped },
      null,
    );
  },
};

const hnWhoIsHiring: PagingPlan = {
  pagesPerSync: 5,
  delayMs: 300,
  first: (targetUrl) => {
    if (targetUrl.includes('tags=comment')) {
      return { url: targetUrl, state: { stage: 'comments', page: 0 } };
    }
    return { url: targetUrl, state: { stage: 'story' } };
  },
  next: (previous, payload) => {
    const state = record(previous.state);
    if (state.stage === 'story') {
      const hits = asArray(record(payload).hits) ?? [];
      const matching = hits.find((h) => {
        const title = text(record(h).title).toLowerCase();
        return (
          title.includes('who is hiring') &&
          !title.includes('who wants to be hired') &&
          !title.includes('freelancer')
        );
      });
      const storyId = text(record(matching).objectID);
      if (!storyId) return null;
      return {
        url: `https://hn.algolia.com/api/v1/search?tags=comment,story_${storyId}&hitsPerPage=1000`,
        state: { stage: 'comments', storyId, page: 0 },
      };
    }
    if (state.stage === 'comments') {
      const page = numeric(state.page) ?? 0;
      const nbPages = numeric(record(payload).nbPages) ?? 1;
      const storyId = text(state.storyId);
      if (storyId && page + 1 < nbPages) {
        return {
          url: `https://hn.algolia.com/api/v1/search?tags=comment,story_${storyId}&hitsPerPage=1000&page=${page + 1}`,
          state: { stage: 'comments', storyId, page: page + 1 },
        };
      }
    }
    return null;
  },
};

function naukriFirstRequest(targetUrl: string): PagedRequest {
  const url = new URL(targetUrl);
  if (!url.searchParams.has('keyword')) url.searchParams.set('keyword', 'software engineer');
  if (!url.searchParams.has('pageNo')) url.searchParams.set('pageNo', '1');
  if (!url.searchParams.has('sort')) url.searchParams.set('sort', 'date');
  if (!url.searchParams.has('noOfResults')) url.searchParams.set('noOfResults', '20');
  return {
    url: url.toString(),
    headers: naukriHeaders(),
    state: { page: 1 },
  };
}

const naukri: PagingPlan = {
  pagesPerSync: 10,
  delayMs: 1_000,
  first: (targetUrl) => naukriFirstRequest(targetUrl),
  next: (previous, payload) => {
    const jobDetails = asArray(record(payload).jobDetails) ?? [];
    if (jobDetails.length === 0) return null;
    const page = pageOf(previous.url, 'pageNo') || 1;
    if (page >= 50) return null;
    return {
      url: withParam(previous.url, 'pageNo', String(page + 1)),
      headers: naukriHeaders(),
      state: { page: page + 1 },
    };
  },
};

function bdjobsFirstRequest(targetUrl: string): PagedRequest {
  const url = new URL(targetUrl);
  if (!url.searchParams.has('hidJobSearch')) url.searchParams.set('hidJobSearch', 'jobsearch');
  if (!url.searchParams.has('txtKeyword')) url.searchParams.set('txtKeyword', 'software engineer');
  if (!url.searchParams.has('pg')) url.searchParams.set('pg', '1');
  return {
    url: url.toString(),
    headers: bdjobsHeaders(),
    state: { page: 1 },
  };
}

const bdjobs: PagingPlan = {
  pagesPerSync: 10,
  delayMs: 1_000,
  first: (targetUrl) => bdjobsFirstRequest(targetUrl),
  next: (previous, payload) => {
    const items = asArray(record(payload).data) ?? asArray(payload) ?? [];
    if (items.length === 0) return null;
    const page = pageOf(previous.url, 'pg') || 1;
    if (page >= 50) return null;
    return {
      url: withParam(previous.url, 'pg', String(page + 1)),
      headers: bdjobsHeaders(),
      state: { page: page + 1 },
    };
  },
};

function ziprecruiterFirstRequest(targetUrl: string): PagedRequest {
  const url = new URL(targetUrl);
  if (!url.searchParams.has('search')) url.searchParams.set('search', 'software engineer');
  if (!url.searchParams.has('location')) url.searchParams.set('location', 'United States');
  if (!url.searchParams.has('page')) url.searchParams.set('page', '1');
  if (!url.searchParams.has('per_page')) url.searchParams.set('per_page', '50');
  return {
    url: url.toString(),
    headers: ziprecruiterHeaders(),
    state: { page: 1 },
  };
}

const ziprecruiter: PagingPlan = {
  pagesPerSync: 10,
  delayMs: 800,
  first: (targetUrl) => ziprecruiterFirstRequest(targetUrl),
  next: (previous, payload) => {
    const jobs = asArray(record(payload).jobs) ?? [];
    if (jobs.length === 0) return null;
    const page = pageOf(previous.url, 'page') || 1;
    if (page >= 50) return null;
    const continueToken = text(record(payload).continue);
    let nextUrl = withParam(previous.url, 'page', String(page + 1));
    if (continueToken) {
      nextUrl = withParam(nextUrl, 'continue_from', continueToken);
    }
    return {
      url: nextUrl,
      headers: ziprecruiterHeaders(),
      state: { page: page + 1, continueToken },
    };
  },
};

function glassdoorFirstRequest(targetUrl: string): PagedRequest {
  const url = targetUrl.startsWith('http') ? targetUrl : GLASSDOOR_GRAPHQL_URL;
  return {
    url,
    method: 'POST',
    body: glassdoorPayload('software engineer', 'United States', 1, 30),
    headers: glassdoorHeaders(),
    state: { page: 1 },
  };
}

const glassdoor: PagingPlan = {
  pagesPerSync: 10,
  delayMs: 1_000,
  first: (targetUrl) => glassdoorFirstRequest(targetUrl),
  next: (previous, payload) => {
    const root = record(payload);
    const data = record(root.data);
    const listings =
      asArray(data.jobListings) ??
      asArray(record(data.jobSearchResults).jobListings) ??
      asArray(root.jobListings) ??
      [];
    if (listings.length === 0) return null;
    const page = numeric(record(previous.state).page) ?? 1;
    if (page >= 20) return null;
    return {
      url: previous.url,
      method: 'POST',
      body: glassdoorPayload('software engineer', 'United States', page + 1, 30),
      headers: glassdoorHeaders(),
      state: { page: page + 1 },
    };
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
  'src-indeed': indeed,
  'src-qualcomm-careers': eightfold,
  'src-hn-whoishiring': hnWhoIsHiring,
  [NAUKRI_SOURCE_ID]: naukri,
  [BDJOBS_SOURCE_ID]: bdjobs,
  [ZIPRECRUITER_SOURCE_ID]: ziprecruiter,
  [GLASSDOOR_SOURCE_ID]: glassdoor,
};

export function pagingPlanFor(sourceId: string): PagingPlan | null {
  if (sourceId.startsWith(WORKDAY_SOURCE_PREFIX)) return workday;
  return PLANS[sourceId] ?? null;
}

export function isWorkdaySource(sourceId: string): boolean {
  return sourceId.startsWith(WORKDAY_SOURCE_PREFIX);
}
