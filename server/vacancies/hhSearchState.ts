import type { UnifiedVacancy, VacancySalary } from '../domain/unifiedVacancy';
import { htmlToFeedText } from '../connectors/feedText';

/**
 * Разбор состояния страницы поиска hh.ru (B214).
 *
 * ПОЧЕМУ НЕ API И НЕ HTML. `api.hh.ru/vacancies` отвечает `403` всем
 * неавторизованным с апреля 2026 (INC-022, B175), а приложение на dev.hh.ru
 * кандидату недоступно — решение владельца 2026-09-13: этот путь закрыт
 * навсегда. RSS площадки отдаёт ровно 20 записей и не листается. Остаётся
 * страница поиска, и разбирать её как HTML не нужно: страница несёт полное
 * состояние выдачи в `<template id="HH-Lux-InitialState">` — тот же JSON, что
 * читает собственное приложение площадки, с полями богаче прежнего API.
 *
 * Разбор намеренно строгий в одну сторону: нечитаемый ответ падает (капча,
 * редирект, смена разметки), а пустая выдача — это ноль записей. Иначе
 * подмена страницы молча превратится в «вакансий нет», и причина снова
 * потеряется, как она терялась на гео-блоке.
 */

export const HH_STATE_UNREADABLE = 'hh_search_state_unreadable';

/** Идентификатор источника в реестре — им же помечается происхождение записи. */
export const HH_SEARCH_SOURCE_ID = 'src-hh-search';

export interface HhSearchStateContext {
  readonly observedAt: string;
  readonly sourceName?: string;
}

export interface HhSearchStateResult {
  /** Сколько вакансий площадка насчитала по запросу — не сколько отдала. */
  readonly totalResults: number;
  readonly vacancies: readonly UnifiedVacancy[];
}

const STATE_PATTERN = /id="HH-Lux-InitialState"[^>]*>([\s\S]*?)<\/template>/;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  amp: '&',
  nbsp: '\u00a0',
};

const ENTITY_PATTERN = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g;

/**
 * Разэкранирование содержимого `<template>`.
 *
 * ЖИВАЯ ПЛОЩАДКА ЭКРАНИРУЕТ ЧИСЛАМИ. Первая версия знала только именованные
 * сущности (`&quot;`), прошла все образцы и упала на настоящей странице: hh.ru
 * пишет `&#34;`, а не `&quot;`. Поэтому здесь разбираются обе записи, включая
 * шестнадцатеричную.
 *
 * Замена идёт одним проходом намеренно. Последовательные `replaceAll` сначала
 * превращали бы `&amp;#34;` в `&#34;`, а потом — в кавычку, и текст, где
 * площадка буквально написала «&#34;», разъехался бы в разметку.
 */
function unescapeTemplate(value: string): string {
  return value.replace(ENTITY_PATTERN, (match, decimal, hex, name) => {
    if (decimal !== undefined) {
      const code = Number.parseInt(decimal, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (hex !== undefined) {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named = NAMED_ENTITIES[String(name).toLowerCase()];
    return named ?? match;
  });
}

/**
 * Зарплата: у площадки «не указана» приходит отдельным полем `noCompensation`,
 * а вилка бывает односторонней. Ноль вместо «неизвестно» здесь недопустим —
 * кандидат прочитает его как «платят нисколько» (то же правило, что в B161).
 */
function readSalary(value: unknown): VacancySalary | undefined {
  const compensation = record(value);
  if ('noCompensation' in compensation) return undefined;

  const from = positiveNumber(compensation.from);
  const to = positiveNumber(compensation.to);
  if (from === undefined && to === undefined) return undefined;

  const currency = text(compensation.currencyCode);
  return {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(currency ? { currency } : {}),
    ...(typeof compensation.gross === 'boolean' ? { gross: compensation.gross } : {}),
  };
}

/**
 * Удалённость площадка называет сама, отдельным полем. Читать её из названия
 * вакансии — гадание, которое уже давало брак на других источниках (B164).
 */
function readIsRemote(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((group) => {
    const elements = record(group).workFormatsElement;
    return Array.isArray(elements) && elements.some((item) => text(item) === 'REMOTE');
  });
}

/**
 * Дата публикации приходит двумя способами; берётся та, что названа площадкой.
 * Непрочитанная дата — не «сегодня»: подставленное сегодня делает старую
 * вакансию свежей (правило `jsonVacancyRecord`).
 */
function readPublishedAt(vacancy: Record<string, unknown>, fallback: string): string {
  const publication = record(vacancy.publicationTime);
  const stated = text(publication.$);
  if (stated) return stated;
  const created = text(vacancy.creationTime);
  return created || fallback;
}

function readVacancy(
  value: unknown,
  context: HhSearchStateContext,
): UnifiedVacancy | null {
  const vacancy = record(value);
  const url = text(record(vacancy.links).desktop);
  const title = htmlToFeedText(text(vacancy.name));
  const company = htmlToFeedText(text(record(vacancy.company).name));

  // Запись без ссылки, названия или работодателя не показывается вовсе: открыть
  // её нельзя, а выдуманный работодатель запрещён с B161.
  if (!url || !title || !company) return null;

  const externalId = text(vacancy.vacancyId);
  const id = `${HH_SEARCH_SOURCE_ID}:${externalId || url}`;
  const location = htmlToFeedText(text(record(vacancy.area).name));

  return {
    id,
    fingerprint: id,
    title,
    company,
    ...(location ? { location } : {}),
    isRemote: readIsRemote(vacancy.workFormats),
    ...(readSalary(vacancy.compensation) ? { salary: readSalary(vacancy.compensation) } : {}),
    // Страница поиска описания не несёт — оно живёт на странице самой вакансии.
    // Пустая строка честнее, чем склейка названия с городом под видом описания.
    description: '',
    requiredSkills: [],
    ...(text(vacancy.employmentForm) ? { employmentType: text(vacancy.employmentForm) } : {}),
    ...(text(vacancy.workExperience) ? { experienceLevel: text(vacancy.workExperience) } : {}),
    url,
    provenance: {
      sourceType: 'json_api',
      sourceId: HH_SEARCH_SOURCE_ID,
      sourceName: context.sourceName,
      sourceUrl: url,
      externalId: externalId || undefined,
      observedAt: context.observedAt,
    },
    publishedAt: readPublishedAt(vacancy, context.observedAt),
    status: 'active',
  };
}

export function parseHhSearchState(
  page: string,
  context: HhSearchStateContext,
): HhSearchStateResult {
  const match = STATE_PATTERN.exec(page);
  if (!match) throw new Error(HH_STATE_UNREADABLE);

  let state: unknown;
  try {
    state = JSON.parse(unescapeTemplate(match[1]));
  } catch {
    throw new Error(HH_STATE_UNREADABLE);
  }

  const search = record(record(state).vacancySearchResult);
  const items = search.vacancies;
  if (!Array.isArray(items)) throw new Error(HH_STATE_UNREADABLE);

  const vacancies = items
    .map((item) => readVacancy(item, context))
    .filter((item): item is UnifiedVacancy => item !== null);

  return {
    totalResults: positiveNumber(search.totalResults) ?? 0,
    vacancies,
  };
}
