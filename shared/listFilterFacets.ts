import { detectVacancyWorkFormat, type VacancyWorkFormat } from './vacancyWorkFormat';

/**
 * B729: числа фильтров «Подборки» по всей отобранной выдаче. Сервер отдаёт их с первой
 * страницей, пока клиент дочитывает пул; клиент после дочитывания считает теми же правилами,
 * поэтому числа совпадают.
 */
export interface FacetRow {
  readonly cluster: {
    readonly canonicalLocation?: string;
    readonly isRemote?: boolean;
    readonly workFormat?: VacancyWorkFormat;
    readonly descriptionSummary?: string;
    readonly firstObservedAt: string;
    readonly sources: readonly { readonly observedAt?: string }[];
  };
}

export type ListDatePeriodId = 'today' | '7' | '30' | '90';

/** Периоды «Даты»: от начала сегодняшнего дня кандидата назад на `days` дней. */
export const LIST_DATE_PERIODS: readonly {
  readonly id: ListDatePeriodId;
  readonly days: number;
}[] = [
  { id: 'today', days: 0 },
  { id: '7', days: 7 },
  { id: '30', days: 30 },
  { id: '90', days: 90 },
];

const DAY_MS = 86_400_000;

export const LIST_WORK_FORMATS: readonly VacancyWorkFormat[] = ['remote', 'hybrid', 'office'];

export interface ListCount<Id extends string> {
  readonly id: Id;
  readonly count: number;
}

export interface ListPlaceCount {
  readonly location: string;
  readonly count: number;
}

export interface FilteredFacetCounts {
  readonly formats: readonly ListCount<VacancyWorkFormat>[];
  readonly places: readonly ListPlaceCount[];
  readonly remote: number;
  /** Моменты появления строк (мс). Даты считаются на ответе: граница дня зависит от пояса. */
  readonly observed: readonly number[];
}

/** Числа «Даты», «Формата» и «Локаций» в ответе первой страницы. */
export interface MatchedFilteredFacets {
  readonly formats: readonly ListCount<VacancyWorkFormat>[];
  readonly places: readonly ListPlaceCount[];
  readonly remote: number;
  readonly dates?: readonly ListCount<ListDatePeriodId>[];
}

export function rowObservedAt(row: FacetRow): number {
  return Date.parse(row.cluster.sources[0]?.observedAt ?? row.cluster.firstObservedAt);
}

export function rowWorkFormat(row: FacetRow): VacancyWorkFormat {
  return (
    row.cluster.workFormat ??
    detectVacancyWorkFormat({
      location: row.cluster.canonicalLocation,
      summary: row.cluster.descriptionSummary,
      isRemote: row.cluster.isRemote ?? false,
    })
  );
}

export function rowPlace(row: FacetRow): string | undefined {
  return row.cluster.canonicalLocation?.trim() || undefined;
}

function placeCounts(rows: readonly FacetRow[]): readonly ListPlaceCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const place = rowPlace(row);
    if (place) counts.set(place, (counts.get(place) ?? 0) + 1);
  }
  return [...counts]
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count || a.location.localeCompare(b.location, 'ru-RU'));
}

export function filteredFacetsOf(rows: readonly FacetRow[]): FilteredFacetCounts {
  const formats = LIST_WORK_FORMATS.map((id) => ({
    id,
    count: rows.filter((row) => rowWorkFormat(row) === id).length,
  }));
  return {
    formats,
    places: placeCounts(rows),
    remote: rows.filter((row) => row.cluster.isRemote).length,
    observed: rows.map(rowObservedAt).filter((at) => !Number.isNaN(at)),
  };
}

/** Начало периода: та же граница, что у фильтра «Дата» в списке. */
export function periodStart(startOfToday: number, days: number): number {
  return startOfToday - days * DAY_MS;
}

export function dateFacet(
  observed: readonly number[],
  startOfToday: number,
): readonly ListCount<ListDatePeriodId>[] {
  return LIST_DATE_PERIODS.map(({ id, days }) => {
    const from = periodStart(startOfToday, days);
    return { id, count: observed.filter((at) => at >= from).length };
  });
}
