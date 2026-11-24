import type { CoachTurnInput } from '../domain/coach';
import { parseVacancyLocation } from '../../shared/locationTree';

/** Подборка в ходе консультанта — её форму задаёт схема хода (B735). */
export type SelectionContext = NonNullable<
  NonNullable<CoachTurnInput['careerContext']>['selection']
>;
export type SelectionRow = SelectionContext['rows'][number];
type SelectionGroup = SelectionContext['summary']['byCountry'][number];

/** Данных в вакансии нет: отдельная группа, а не чужая. */
export const SELECTION_UNKNOWN = 'неизвестно';

function grouped(
  rows: readonly SelectionRow[],
  labelOf: (row: SelectionRow) => string | null,
): SelectionGroup[] {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const label = labelOf(row) ?? SELECTION_UNKNOWN;
    groups.set(label, [...(groups.get(label) ?? []), row.n]);
  }
  return [...groups]
    .map(([label, numbers]) => ({ label, count: numbers.length, rows: numbers }))
    .sort(
      (a, b) =>
        Number(a.label === SELECTION_UNKNOWN) - Number(b.label === SELECTION_UNKNOWN) ||
        b.count - a.count,
    );
}

/** Город строки в одном написании: «Moscow» и «Москва, Россия» — один город. */
function placeOf(row: SelectionRow): string | null {
  if (!row.location) return null;
  return parseVacancyLocation({ location: row.location })?.city ?? row.location;
}

/** Сервер считает сам: модель по строкам ошибалась в счёте, стране и формате. */
export function selectionSummary(rows: readonly SelectionRow[]): SelectionContext['summary'] {
  return {
    shown: rows.length,
    byPlace: grouped(rows, placeOf),
    byCountry: grouped(rows, (row) => row.country),
    byFormat: grouped(rows, (row) => row.format),
  };
}
