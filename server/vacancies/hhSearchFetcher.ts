import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { parseHhSearchState, HH_SEARCH_SOURCE_ID } from './hhSearchState';

/**
 * Сбор вакансий со страницы поиска hh.ru (B214).
 *
 * ДВА ПУТИ НАРУЖУ. Площадка отвечает не всем адресам: с рабочей машины
 * владельца (египетский выход) приходит `451` на весь домен, включая
 * `robots.txt`, а с прода во Франкфурте — `200` с настоящей выдачей. Прежний
 * вывод «RSS hh.ru даёт 0 записей» был артефактом этого блока, а не пустой
 * лентой. Поэтому транспорт здесь — параметр, а не `fetch` внутри: за прямым
 * путём стоит запасной через российский выход.
 *
 * ОТКАЗ — НЕ ПУСТОТА. Гео-блок, капча и смена разметки обязаны падать. Пустой
 * успех на месте отказа once уже стоил нам недели: источник числился живым и
 * отдавал ноль, и причину никто не искал (B161, B199).
 */

export const HH_SEARCH_BLOCKED = 'hh_search_blocked';

/** Регион «вся Россия» в справочнике площадки. */
const ALL_RUSSIA_AREA = '113';

export interface HhSearchTransportResult {
  readonly status: number;
  readonly body: string;
}

export type HhSearchTransport = (url: string) => Promise<HhSearchTransportResult>;

export interface HhSearchOptions {
  readonly query?: string;
  readonly area?: string;
  readonly page?: number;
}

export interface HhSearchFetchDeps {
  readonly transport: HhSearchTransport;
  /** Запасной выход: используется только когда прямой путь отказал. */
  readonly fallbackTransport?: HhSearchTransport;
  readonly observedAt: string;
}

export interface HhSearchFetchResult {
  readonly totalResults: number;
  readonly vacancies: readonly UnifiedVacancy[];
}

export function buildHhSearchUrl(options: HhSearchOptions): string {
  const url = new URL('https://hh.ru/search/vacancy');
  if (options.query) url.searchParams.set('text', options.query);
  url.searchParams.set('area', options.area ?? ALL_RUSSIA_AREA);
  url.searchParams.set('page', String(options.page ?? 0));
  // Порядок по времени публикации: свежие вакансии должны попадать в первый же
  // срез, иначе веер читает одно и то же старое ядро выдачи.
  url.searchParams.set('order_by', 'publication_time');
  return url.toString();
}

/** Отказ площадки, который нельзя принять за пустую выдачу. */
function isRefusal(result: HhSearchTransportResult): boolean {
  return result.status !== 200 || result.body.length === 0;
}

export async function fetchHhSearch(
  source: VacancySourceConfig,
  options: HhSearchOptions,
  deps: HhSearchFetchDeps,
): Promise<HhSearchFetchResult> {
  const url = buildHhSearchUrl(options);

  let result = await deps.transport(url);
  if (isRefusal(result) && deps.fallbackTransport) {
    result = await deps.fallbackTransport(url);
  }
  if (isRefusal(result)) {
    throw new Error(`${HH_SEARCH_BLOCKED}: ${result.status}`);
  }

  // Разбор падает сам, если состояния на странице нет: капча и редирект
  // приходят с кодом 200 и выглядят как обычный ответ.
  const parsed = parseHhSearchState(result.body, {
    observedAt: deps.observedAt,
    sourceName: source.name,
  });

  return { totalResults: parsed.totalResults, vacancies: parsed.vacancies };
}

export { HH_SEARCH_SOURCE_ID };
