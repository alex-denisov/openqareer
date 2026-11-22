/**
 * B725: страница 0 кабинета B640 и фасеты фильтров приходят двумя параллельными запросами.
 *
 * Прод 20.11: страница 0 весила 87 КБ при 19 КБ у остальных — почти всё в ней фасеты.
 * Клиент с `part=rows` получает строки без фасетов, с `part=facets` — фасеты без строк и без
 * разбора процентов. Запрос без `part` отвечает как раньше: старый клиент после выката не
 * теряет фильтры.
 */
import { z } from 'zod';
import { dateFacet } from '../../shared/listFilterFacets';
import type { MatchedVacancyFacets } from '../../shared/matchedVacancyFacets';
import { startOfDayIn } from './careerRoleCounts';

export type MatchedPart = 'rows' | 'facets' | 'all';

const partSchema = z.object({ part: z.enum(['rows', 'facets']).optional() });

/** Неизвестное значение читается как прежний полный ответ. */
export function readMatchedPart(query: unknown): MatchedPart {
  const parsed = partSchema.safeParse(query);
  return parsed.success ? (parsed.data.part ?? 'all') : 'all';
}

/**
 * B729: числа периодов «Даты» по всей выдаче. Граница дня — по поясу кандидата и на момент
 * ответа, поэтому они не хранятся со списком, а считаются здесь из моментов появления строк.
 */
export function withFilteredDates(
  facets: MatchedVacancyFacets,
  observed: readonly number[] | undefined,
  timeZone: string,
): MatchedVacancyFacets {
  if (!facets.filtered || !observed) return facets;
  const dates = dateFacet(observed, startOfDayIn(new Date(), timeZone));
  return { ...facets, filtered: { ...facets.filtered, dates } };
}

export interface FacetsSource {
  readonly facets?: MatchedVacancyFacets;
  readonly filteredObserved?: readonly number[];
  readonly total: number;
}

/** Ответ `part=facets`: без строк, процентов и фоновой работы по ним — её начинает запрос строк. */
export function matchedFacetsResponse(source: FacetsSource, requestId: string, timeZone: string) {
  return {
    data: [],
    meta: {
      requestId,
      total: source.total,
      ...(source.facets
        ? { facets: withFilteredDates(source.facets, source.filteredObserved, timeZone) }
        : {}),
    },
  };
}
