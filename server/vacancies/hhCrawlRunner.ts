import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { parseHhSearchState } from './hhSearchState';
import { HH_PAGE_SIZE, HH_RESULT_CAP, planQueryUrl, type HhCrawlPlan } from './hhCrawlPlan';
import type { HhSearchTransportResult } from './hhSearchFetcher';

/**
 * Исполнение веера обхода hh.ru (B214, срез 4).
 *
 * ОДИН ПРОХОД — ОДИН ПАКЕТ. Пересборка кластеров стоит около четырёх секунд на
 * сорока тысячах записей (замер 2026-09-13), и делать её на каждой прочитанной
 * странице — значит занять сервер на час. Поэтому проход накапливает записи у
 * себя и отдаёт их одним пакетом; пересобирает пул вызывающий, один раз.
 *
 * ОТКАЗ ПЛОЩАДКИ ОСТАНАВЛИВАЕТ ПРОХОД. Несколько отказов подряд означают, что
 * площадка закрылась — продолжать значит напрашиваться на блокировку адреса.
 * Одиночный сбой страницы при этом проход не отменяет: он считается и идёт
 * в отчёт, потому что «собрано меньше» обязано иметь названную причину.
 *
 * ПРОХОД УМЕЕТ ОСТАНАВЛИВАТЬСЯ И ПРОДОЛЖАТЬСЯ (B219). Глубокий проход по 133
 * ролям идёт часы, а служба перезапускается на каждом выкате. Поэтому проход
 * начинается с переданного курсора, после каждой страницы называет следующий
 * и прекращается по бюджету времени, не считая это отказом: `finished`
 * говорит, дочитан ли план, `cursor` — откуда читать дальше.
 */

export const HH_CRAWL_ABANDONED = 'hh_crawl_abandoned';

/** Пауза между обращениями по умолчанию: обход остаётся заметно вежливее живого человека. */
const DEFAULT_DELAY_MS = 1_000;

/** Сколько отказов подряд означают «площадка закрылась». */
const DEFAULT_REFUSAL_LIMIT = 5;

export interface HhCrawlProgress {
  readonly pagesRead: number;
  readonly pagesPlanned: number;
  readonly vacanciesFound: number;
}

/** Место в плане: какая часть и какая её страница читается следующей. */
export interface HhCrawlCursor {
  readonly queryIndex: number;
  readonly page: number;
}

export interface HhCrawlDeps {
  readonly fetchPage: (url: string) => Promise<HhSearchTransportResult>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly searchPeriodDays: number;
  readonly delayMs?: number;
  readonly refusalLimit?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: HhCrawlProgress) => void;
  readonly sourceName?: string;
  readonly now?: () => string;
  /** Откуда продолжать; без курсора — с начала плана. */
  readonly start?: HhCrawlCursor;
  /** Часы для бюджета, миллисекунды; по умолчанию `Date.now`. */
  readonly clock?: () => number;
  /** Момент по `clock`, после которого страницы больше не читаются. */
  readonly deadlineMs?: number;
  /** Вызывается после каждой прочитанной страницы: курсор можно сохранить. */
  readonly onCursor?: (cursor: HhCrawlCursor, pagesRead: number, errors: number) => void;
  /** Знает ли пул запись с таким id — для правила остановки быстрого прохода. */
  readonly isKnown?: (id: string) => boolean;
}

export interface HhCrawlResult {
  readonly vacancies: readonly UnifiedVacancy[];
  readonly pagesRead: number;
  readonly duplicatesSkipped: number;
  readonly errors: number;
  /** Проход остановлен отменой снаружи. */
  readonly stoppedEarly: boolean;
  /** План дочитан до конца: ни отмены, ни бюджета не случилось. */
  readonly finished: boolean;
  /** Откуда читать дальше; после дочитанного плана — за его концом. */
  readonly cursor: HhCrawlCursor;
}

interface SweepState {
  readonly collected: Map<string, UnifiedVacancy>;
  pagesRead: number;
  duplicatesSkipped: number;
  errors: number;
  refusalsInARow: number;
}

/** Что делать дальше после одной страницы. */
type PageOutcome = 'continue' | 'end-query';

interface PageReading {
  readonly outcome: PageOutcome;
  /** Сколько записей было на странице; полная страница — признак, что выдача не кончилась. */
  readonly itemsOnPage: number;
}

/** Потолок площадки в страницах: страница 40 отвечает `404`. */
const HH_MAX_PAGES = HH_RESULT_CAP / HH_PAGE_SIZE;

/** Сколько записей страницы проход видит впервые — и не знает их пул. */
function absorb(
  parsedVacancies: readonly UnifiedVacancy[],
  state: SweepState,
  isKnown: (id: string) => boolean,
): number {
  let unseen = 0;
  for (const vacancy of parsedVacancies) {
    // «Новое» меряется по пулу, а не по улову тика: вакансия с двумя ролями,
    // уже пойманная через первую роль, всё ещё неизвестна пулу — и правило
    // остановки у второй роли не должно считать её старой.
    if (!isKnown(vacancy.id)) unseen += 1;
    if (state.collected.has(vacancy.fingerprint)) {
      state.duplicatesSkipped += 1;
      continue;
    }
    state.collected.set(vacancy.fingerprint, vacancy);
  }
  return unseen;
}

async function readPage(
  url: string,
  state: SweepState,
  deps: HhCrawlDeps,
  observedAt: string,
  refusalLimit: number,
  stopWhenNothingNew: boolean,
): Promise<PageReading> {
  let response = await deps.fetchPage(url);
  await deps.sleep(deps.delayMs ?? DEFAULT_DELAY_MS);

  // Одиночный сбой страницы повторяется один раз: непрочитанная страница —
  // это до 50 живых вакансий, которых проход «не видел», а по итогам
  // полного прохода невиденное снимается (B219). Повтор дешевле потери.
  if (response.status !== 200 || !response.body) {
    response = await deps.fetchPage(url);
    await deps.sleep(deps.delayMs ?? DEFAULT_DELAY_MS);
  }

  if (response.status !== 200 || !response.body) {
    state.errors += 1;
    state.refusalsInARow += 1;
    if (state.refusalsInARow >= refusalLimit) {
      throw new Error(`${HH_CRAWL_ABANDONED}: ${response.status}`);
    }
    return { outcome: 'continue', itemsOnPage: 0 };
  }
  state.refusalsInARow = 0;
  state.pagesRead += 1;

  let parsed;
  try {
    parsed = parseHhSearchState(response.body, {
      observedAt,
      ...(deps.sourceName ? { sourceName: deps.sourceName } : {}),
    });
  } catch {
    // Капча или смена разметки: страница пришла с кодом 200 и выглядит
    // обычной, но выдачи в ней нет. Это сбой, а не пустая выдача.
    state.errors += 1;
    return { outcome: 'continue', itemsOnPage: 0 };
  }

  const unseen = absorb(parsed.vacancies, state, deps.isKnown ?? (() => false));
  const itemsOnPage = parsed.vacancies.length;
  // Выдача кончилась раньше плана — площадка пересчитала её, пока шёл обход.
  if (itemsOnPage === 0) return { outcome: 'end-query', itemsOnPage };
  // Страница без единой новой записи: ниже по выдаче «свежие первыми» лежит
  // только то, что пул уже видел (B219).
  return { outcome: stopWhenNothingNew && unseen === 0 ? 'end-query' : 'continue', itemsOnPage };
}

async function crawlQueryPages(
  query: HhCrawlPlan['queries'][number],
  queryIndex: number,
  startPage: number,
  state: SweepState,
  deps: HhCrawlDeps,
  plan: HhCrawlPlan,
  observedAt: string,
  refusalLimit: number,
  clock: () => number,
): Promise<{ cursor: HhCrawlCursor; stopped: boolean }> {
  let page = startPage;
  // Число страниц в плане — оценка на момент замера. План живёт до недели, и
  // часть могла подрасти: пока последняя плановая страница полная, чтение
  // продолжается до потолка площадки, иначе невиденные живые записи были бы
  // сняты по итогам прохода (B219).
  // A persisted continuation may point exactly at the original estimate after
  // a full page extended the effective limit. Keep that pending page in the
  // local boundary for this invocation (PRB-026).
  let limit = Math.max(query.pages, startPage + 1);
  const stopAfter = query.stopWhenNothingNewAfter;

  while (page < limit) {
    if (deps.signal?.aborted || (deps.deadlineMs !== undefined && clock() >= deps.deadlineMs)) {
      return { cursor: { queryIndex, page }, stopped: true };
    }

    const url = planQueryUrl(query, deps.searchPeriodDays, page);
    const stopWhenNothingNew = stopAfter !== undefined && page + 1 >= stopAfter;
    const reading = await readPage(url, state, deps, observedAt, refusalLimit, stopWhenNothingNew);
    page += 1;

    deps.onProgress?.({
      pagesRead: state.pagesRead,
      pagesPlanned: plan.expectedPages,
      vacanciesFound: state.collected.size,
    });

    if (reading.outcome === 'end-query') page = limit;
    else if (page === limit && reading.itemsOnPage >= HH_PAGE_SIZE && limit < HH_MAX_PAGES) {
      limit += 1;
    }
    const cursor = page < limit ? { queryIndex, page } : nextQuery({ queryIndex, page });
    deps.onCursor?.(cursor, state.pagesRead, state.errors);
  }

  return { cursor: nextQuery({ queryIndex, page: 0 }), stopped: false };
}

export async function runHhCrawl(plan: HhCrawlPlan, deps: HhCrawlDeps): Promise<HhCrawlResult> {
  const refusalLimit = deps.refusalLimit ?? DEFAULT_REFUSAL_LIMIT;
  const observedAt = (deps.now ?? (() => new Date().toISOString()))();
  // Ключ — отпечаток записи: одна вакансия попадает в несколько частей веера
  // (роль × опыт × регион пересекаются на границах), и пул не должен считать
  // их разными.
  const state: SweepState = {
    collected: new Map(),
    pagesRead: 0,
    duplicatesSkipped: 0,
    errors: 0,
    refusalsInARow: 0,
  };
  const clock = deps.clock ?? Date.now;
  let cursor: HhCrawlCursor = deps.start ?? { queryIndex: 0, page: 0 };
  let stoppedEarly = false;

  while (cursor.queryIndex < plan.queries.length) {
    const query = plan.queries[cursor.queryIndex]!;
    // Часть без страниц (или курсор за её концом) пропускается, иначе цикл
    // стоял бы на ней вечно.
    // A budget stop can persist the first page beyond the estimate when the
    // last planned page was full and the query was dynamically extended. That
    // page is real pending work, not a completed query (PRB-026).
    if (query.pages <= 0 && cursor.page === 0) {
      cursor = nextQuery(cursor);
      continue;
    }

    const outcome = await crawlQueryPages(
      query,
      cursor.queryIndex,
      cursor.page,
      state,
      deps,
      plan,
      observedAt,
      refusalLimit,
      clock,
    );
    cursor = outcome.cursor;
    if (outcome.stopped) {
      stoppedEarly = Boolean(deps.signal?.aborted);
      break;
    }
  }

  const finished = cursor.queryIndex >= plan.queries.length;

  return {
    vacancies: [...state.collected.values()],
    pagesRead: state.pagesRead,
    duplicatesSkipped: state.duplicatesSkipped,
    errors: state.errors,
    stoppedEarly,
    finished,
    cursor,
  };
}

function nextQuery(cursor: HhCrawlCursor): HhCrawlCursor {
  return { queryIndex: cursor.queryIndex + 1, page: 0 };
}
