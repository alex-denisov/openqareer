import { keepKnownRoleIds } from './hhRoleCatalog';

/**
 * План веера обхода hh.ru (B214, срез 4).
 *
 * ЗАЧЕМ ПЛАН, А НЕ ПРОСТО ЦИКЛ. Площадка отдаёт не больше 2000 записей на один
 * запрос (40 страниц по 50; страница 40 отвечает `404`), а ролей, где записей
 * больше, шесть из двадцати пяти. Обход без дробления молча терял бы разницу:
 * «Программист» — 6247 записей, из них видно 2000. Поэтому план сначала
 * спрашивает у площадки размер каждой части и дробит её, пока часть не влезет
 * в потолок.
 *
 * ОСИ ДРОБЛЕНИЯ ВЫБРАНЫ ПО ЗАМЕРУ, А НЕ ПО ДОГАДКЕ. Опыт делит выдачу без
 * потерь: у роли 96 части дали 382 + 2207 + 2869 + 789 = ровно 6247. Регион —
 * вторая ось для того, что не влезло и по опыту. Даты не годятся: `date_from`
 * и `date_to` веб-поиск игнорирует (проверено 2026-09-13), а `search_period`
 * задаёт только «последние N дней» и окно не вырезает.
 *
 * УСЕЧЕНИЕ НАЗЫВАЕТСЯ ВСЛУХ. Если часть не делится ни одной осью, план берёт
 * её до потолка и считает усечённой. Молчать об этом нельзя: «собрано 38 000»
 * при недостижимых 40 000 — это отчёт, которому нельзя верить.
 */

/** Записей на странице выдачи. */
export const HH_PAGE_SIZE = 50;

/** Потолок площадки на один запрос: страница 40 отвечает `404` (замер 2026-09-13). */
export const HH_RESULT_CAP = 2000;

/** Значения опыта в фильтре площадки — первая ось дробления. */
export const HH_EXPERIENCE_VALUES = [
  'noExperience',
  'between1And3',
  'between3And6',
  'moreThan6',
] as const;

export type HhExperience = (typeof HH_EXPERIENCE_VALUES)[number];

/** Значения графика работы в фильтре площадки — третья ось дробления (B219). */
export const HH_SCHEDULE_VALUES = [
  'fullDay',
  'shift',
  'flexible',
  'remote',
  'flyInFlyOut',
] as const;

export type HhSchedule = (typeof HH_SCHEDULE_VALUES)[number];

/** Значения типа занятости в фильтре площадки — четвёртая ось дробления (B219). */
export const HH_EMPLOYMENT_VALUES = [
  'full',
  'part',
  'project',
  'volunteer',
  'probation',
] as const;

export type HhEmployment = (typeof HH_EMPLOYMENT_VALUES)[number];

export interface HhCrawlQuery {
  readonly roleId: string;
  readonly experience?: HhExperience;
  readonly areaId?: string;
  readonly schedule?: HhSchedule;
  readonly employment?: HhEmployment;
}

export interface HhPlannedQuery extends HhCrawlQuery {
  /** Сколько записей площадка насчитала по этой части. */
  readonly totalResults: number;
  /** Сколько страниц читать: от числа записей, но не больше потолка. */
  readonly pages: number;
  /** True, если часть не влезла в потолок и будет прочитана не целиком. */
  readonly truncated: boolean;
  /**
   * Правило быстрого прохода (B219): начиная с этой страницы часть обрывается,
   * как только на странице не нашлось ни одного неизвестного пулу id. Выдача
   * идёт от свежих к старым, поэтому ниже страницы без нового — только старое.
   */
  readonly stopWhenNothingNewAfter?: number;
}

export interface HhCrawlPlan {
  readonly queries: readonly HhPlannedQuery[];
  readonly expectedResults: number;
  readonly expectedPages: number;
  readonly truncatedQueries: number;
}

export interface CrawlPlanDeps {
  /** Спрашивает у площадки размер части. */
  readonly countResults: (query: HhCrawlQuery) => Promise<number>;
  readonly searchPeriodDays: number;
  /**
   * Вторая ось дробления: дети региона в дереве площадки. Без аргумента —
   * страны верхнего уровня (их девять), для России — её 89 областей.
   *
   * Ось именно древовидная, а не плоским списком: почти вся выдача лежит в
   * России, и одного уровня не хватает — «Россия целиком» сама выходит за
   * потолок и требует дробления дальше.
   */
  readonly areaChildren?: (areaId?: string) => readonly string[];
}

export function planQueryUrl(query: HhCrawlQuery, searchPeriodDays: number, page: number): string {
  const url = new URL('https://hh.ru/search/vacancy');
  url.searchParams.set('professional_role', query.roleId);
  if (query.experience) url.searchParams.set('experience', query.experience);
  if (query.areaId) url.searchParams.set('area', query.areaId);
  if (query.schedule) url.searchParams.set('schedule', query.schedule);
  if (query.employment) url.searchParams.set('employment', query.employment);
  url.searchParams.set('search_period', String(searchPeriodDays));
  // Свежие первыми: обход должен добирать новое, а не перечитывать старое ядро.
  url.searchParams.set('order_by', 'publication_time');
  url.searchParams.set('page', String(page));
  return url.toString();
}

function pagesFor(totalResults: number): number {
  return Math.ceil(Math.min(totalResults, HH_RESULT_CAP) / HH_PAGE_SIZE);
}

function planned(query: HhCrawlQuery, totalResults: number): HhPlannedQuery {
  return {
    ...query,
    totalResults,
    pages: pagesFor(totalResults),
    truncated: totalResults > HH_RESULT_CAP,
  };
}

function chooseSplitAxis(
  query: HhCrawlQuery,
  deps: CrawlPlanDeps,
): readonly Partial<HhCrawlQuery>[] {
  if (query.experience === undefined) {
    return HH_EXPERIENCE_VALUES.map((experience) => ({ experience }));
  }
  const children = deps.areaChildren?.(query.areaId);
  if (children && children.length > 0) {
    return children.map((areaId) => ({ areaId }));
  }
  if (query.schedule === undefined) {
    return HH_SCHEDULE_VALUES.map((schedule) => ({ schedule }));
  }
  if (query.employment === undefined) {
    return HH_EMPLOYMENT_VALUES.map((employment) => ({ employment }));
  }
  return [];
}

/**
 * Дробит одну часть, пока она не влезет в потолок: сначала по опыту, потом по
 * регионам, затем по графику и занятости (B219). Часть, которую не делит ни одна ось,
 * возвращается усечённой.
 */
async function splitQuery(
  query: HhCrawlQuery,
  totalResults: number,
  deps: CrawlPlanDeps,
): Promise<HhPlannedQuery[]> {
  if (totalResults <= HH_RESULT_CAP) {
    return totalResults > 0 ? [planned(query, totalResults)] : [];
  }

  const axis = chooseSplitAxis(query, deps);
  // Ось кончилась — делить больше нечем. Часть берётся до потолка, и это
  // записано в плане, а не скрыто.
  if (axis.length === 0) return [planned(query, totalResults)];

  const parts: HhPlannedQuery[] = [];
  for (const step of axis) {
    const narrowed: HhCrawlQuery = { ...query, ...step };
    const size = await deps.countResults(narrowed);
    parts.push(...(await splitQuery(narrowed, size, deps)));
  }
  return parts;
}

export async function buildCrawlPlan(
  roleIds: readonly string[],
  deps: CrawlPlanDeps,
): Promise<HhCrawlPlan> {
  const queries: HhPlannedQuery[] = [];

  for (const roleId of keepKnownRoleIds(roleIds)) {
    const root: HhCrawlQuery = { roleId };
    const size = await deps.countResults(root);
    queries.push(...(await splitQuery(root, size, deps)));
  }

  return {
    queries,
    expectedResults: queries.reduce((sum, q) => sum + Math.min(q.totalResults, HH_RESULT_CAP), 0),
    expectedPages: queries.reduce((sum, q) => sum + q.pages, 0),
    truncatedQueries: queries.filter((q) => q.truncated).length,
  };
}
