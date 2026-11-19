import type { MatchedVacancyFacets } from '../../../../../shared/matchedVacancyFacets';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { vacancyFormat } from '../../../vacancies/vacancyScreenCriteria';
import {
  DATE_OPTIONS,
  FORMAT_IDS,
  REMOTE_LOCATION,
  applyFilters,
  formatLabel,
  EMPTY_FILTERS,
  type FilterKind,
} from './filterModel';

export interface FilterOption {
  readonly id: string;
  readonly label: string;
  readonly count?: number;
}

export type FilterOptions = Readonly<Record<FilterKind, readonly FilterOption[]>>;

const TOP_COUNT = 6;

function byCount(left: FilterOption, right: FilterOption): number {
  return (
    (right.count ?? 0) - (left.count ?? 0) || left.label.localeCompare(right.label, 'ru-RU')
  );
}

function locationOptions(items: readonly MatchedVacancyItem[]): readonly FilterOption[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const place = item.cluster.canonicalLocation?.trim();
    if (place) counts.set(place, (counts.get(place) ?? 0) + 1);
  }
  const remote = items.filter((item) => item.cluster.isRemote).length;
  const places = [...counts].map(([id, count]) => ({ id, label: id, count }));
  return [
    ...(remote > 0 ? [{ id: REMOTE_LOCATION, label: REMOTE_LOCATION, count: remote }] : []),
    ...places,
  ].sort(byCount);
}

/**
 * Значения фильтров с числом вакансий; роли берёт сервер, остальное считается по загруженным.
 * Число «Даты» — только по дочитанной подборке (B728): до конца чтения оно меньше настоящего.
 */
export function buildOptions(
  items: readonly MatchedVacancyItem[],
  facets: MatchedVacancyFacets | undefined,
  now: Date,
  complete = true,
): FilterOptions {
  const formatCount = (id: string) => items.filter((item) => vacancyFormat(item) === id).length;
  const dateContext = { currency: 'RUB' as const, now };
  return {
    roles: (facets?.roles ?? [])
      .map((entry) => ({ id: entry.role, label: entry.role, count: entry.count }))
      .sort(byCount),
    locations: locationOptions(items),
    formats: FORMAT_IDS.map((id) => ({ id, label: formatLabel(id), count: formatCount(id) })),
    money: [],
    dates: DATE_OPTIONS.map((option) => ({
      id: option.id,
      label: option.label,
      ...(option.id === 'any' || !complete
        ? {}
        : { count: applyFilters(items, { ...EMPTY_FILTERS, date: option.id }, dateContext).length }),
    })),
  };
}

/** Число в шапке и в «Показать»: строки после фильтров или ответ сервера. */
export interface ListCountInput {
  /** Выбран фильтр, который считает клиент (локации, формат, деньги, дата, релокация). */
  readonly narrowed: boolean;
  /** Подборка дочитана целиком. */
  readonly complete: boolean;
  readonly serverMode: boolean;
  /** Итог сервера без скрытых. */
  readonly known: number;
  /** Строк после клиентских фильтров. */
  readonly filtered: number;
}

/**
 * B728: с клиентским фильтром по недочитанной подборке число растёт по мере чтения — его не
 * показываем, пока подборка не дочитана: иначе «Показать 169», а в списке потом 266.
 */
export function listCount(input: ListCountInput): { count: number; countKnown: boolean } {
  const { narrowed, complete, serverMode, known, filtered } = input;
  return {
    count: narrowed || complete ? filtered : Math.max(known, filtered),
    countKnown: !narrowed || complete || serverMode,
  };
}

export function splitOptions(options: readonly FilterOption[], query: string): {
  readonly top: readonly FilterOption[];
  readonly rest: readonly FilterOption[];
} {
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  const found = needle
    ? options.filter((option) => option.label.toLocaleLowerCase('ru-RU').includes(needle))
    : options;
  return { top: found.slice(0, TOP_COUNT), rest: found.slice(TOP_COUNT) };
}
