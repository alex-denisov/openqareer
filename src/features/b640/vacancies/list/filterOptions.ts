import { roleLabel, type RoleTitlesRu } from '../../career/roleLabel';
import type { MatchedVacancyFacets } from '../../../../../shared/matchedVacancyFacets';
import type { MatchedFilteredFacets } from '../../../../../shared/listFilterFacets';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { vacancyFormat } from '../../../vacancies/vacancyScreenCriteria';
import {
  DATE_OPTIONS,
  FORMAT_IDS,
  REMOTE_LOCATION,
  applyFilters,
  formatLabel,
  EMPTY_FILTERS,
  type DateId,
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

/** B729: числа сервера по всей выдаче, пока подборка читается. */
function countOf(counts: readonly { readonly id: string; readonly count: number }[], id: string): number {
  return counts.find((entry) => entry.id === id)?.count ?? 0;
}

function serverLocations(server: MatchedFilteredFacets): readonly FilterOption[] {
  const places = server.places.map(({ location, count }) => ({ id: location, label: location, count }));
  return [
    ...(server.remote > 0 ? [{ id: REMOTE_LOCATION, label: REMOTE_LOCATION, count: server.remote }] : []),
    ...places,
  ].sort(byCount);
}

function dateCount(
  id: DateId,
  complete: boolean,
  server: MatchedFilteredFacets | undefined,
  own: () => number,
): { count?: number } {
  if (id === 'any') return {};
  if (complete) return { count: own() };
  const count = server?.dates?.find((entry) => entry.id === id)?.count;
  return count === undefined ? {} : { count };
}

/** Значение без числа: пока подборка читается, число по загруженным строкам меньше настоящего. */
const withoutCount = ({ id, label }: FilterOption): FilterOption => ({ id, label });

/**
 * Значения фильтров с числом вакансий; роли берёт сервер, остальное считается по загруженным.
 * Числа «Локаций», «Формата» и «Даты» — только по дочитанной подборке (B728): до конца чтения
 * они меньше настоящих. Сами значения видны сразу. B729: пока читается, числа — с сервера по всей
 * выдаче (`facets.filtered`), если он их прислал.
 */
export function buildOptions(
  items: readonly MatchedVacancyItem[],
  facets: MatchedVacancyFacets | undefined,
  now: Date,
  complete = true,
): FilterOptions {
  const formatCount = (id: string) => items.filter((item) => vacancyFormat(item) === id).length;
  const dateContext = { currency: 'RUB' as const, now };
  const counted = (options: readonly FilterOption[]) => (complete ? options : options.map(withoutCount));
  const server = complete ? undefined : facets?.filtered;
  return {
    roles: (facets?.roles ?? [])
      .map((entry) => ({ id: entry.role, label: entry.role, count: entry.count }))
      .sort(byCount),
    locations: server ? serverLocations(server) : counted(locationOptions(items)),
    formats: server
      ? FORMAT_IDS.map((id) => ({ id, label: formatLabel(id), count: countOf(server.formats, id) }))
      : counted(FORMAT_IDS.map((id) => ({ id, label: formatLabel(id), count: formatCount(id) }))),
    money: [],
    dates: DATE_OPTIONS.map((option) => ({
      id: option.id,
      label: option.label,
      ...dateCount(option.id, complete, server, () =>
        applyFilters(items, { ...EMPTY_FILTERS, date: option.id }, dateContext).length,
      ),
    })),
  };
}

/** B726: роли фильтра и их чипы — русскими названиями ролей поиска (`titlesRu` кампании). */
export function withRoleLabels(options: FilterOptions, titlesRu: RoleTitlesRu = {}): FilterOptions {
  return {
    ...options,
    roles: options.roles.map((option) => ({ ...option, label: roleLabel(option.id, titlesRu) })),
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

/**
 * B726: в серверном порядке «Дату» режет и считает сервер. Его итог — число подборки, даже ноль;
 * пока первая порция с «Датой» не пришла, числа нет (иначе мелькнуло бы число всего пула).
 */
export function serverCountState(input: {
  readonly serverMode: boolean;
  /** Сервер режет подборку «Датой» или «Зарплатой от» (B765). */
  readonly dated: boolean;
  readonly total: number;
  readonly loadingFirst: boolean;
}): { readonly serverKnows: boolean; readonly serverPending: boolean } {
  const { serverMode, dated, total, loadingFirst } = input;
  const serverPending = serverMode && dated && loadingFirst;
  return { serverKnows: serverMode && (total > 0 || (dated && !serverPending)), serverPending };
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
