/**
 * Owner 29.10 (mockup 4-vakansii-procent-sort): the list is sorted by the arrows on the «Деньги»
 * and «Совпадение» headers. The server orders the whole selection and remembers the choice per
 * account; «Сначала новые» is gone.
 */
import type { VacancyFitView } from './vacancyFit';
import {
  compareFitPercent,
  vacancyFitPercent,
  vacancyFitStage,
  type VacancyFitStage,
} from './vacancyFitPercent';

export const VACANCY_SORT_KEYS = ['fit', 'money'] as const;
export const VACANCY_SORT_DIRECTIONS = ['desc', 'asc'] as const;
export type VacancySortKey = (typeof VACANCY_SORT_KEYS)[number];
export type VacancySortDirection = (typeof VACANCY_SORT_DIRECTIONS)[number];
export interface VacancySort {
  readonly by: VacancySortKey;
  readonly dir: VacancySortDirection;
}
export const DEFAULT_VACANCY_SORT: VacancySort = { by: 'fit', dir: 'desc' };

export function isVacancySort(value: unknown): value is VacancySort {
  if (typeof value !== 'object' || value === null) return false;
  const { by, dir } = value as Record<string, unknown>;
  return (
    VACANCY_SORT_KEYS.includes(by as VacancySortKey) &&
    VACANCY_SORT_DIRECTIONS.includes(dir as VacancySortDirection)
  );
}

/** Clicking the active column flips it; clicking the other one makes it active, descending. */
export function nextVacancySort(current: VacancySort, clicked: VacancySortKey): VacancySort {
  if (current.by !== clicked) return { by: clicked, dir: 'desc' };
  return { by: clicked, dir: current.dir === 'desc' ? 'asc' : 'desc' };
}

const ASCENDING_RANK: Readonly<Record<VacancyFitStage, number>> = {
  counted: 0,
  counted_low: 0,
  counting: 1,
  none: 2,
};

/**
 * Descending is the CPO order of `compareFitPercent`. Ascending reverses only the counted rows
 * (lowest percent first), then rows still counting; rows that cannot be counted stay last.
 */
export function compareFitDirected(
  left: VacancyFitView | undefined,
  right: VacancyFitView | undefined,
  dir: VacancySortDirection,
): number {
  if (dir === 'desc') return compareFitPercent(left, right);
  const rank = (view: VacancyFitView | undefined) => ASCENDING_RANK[vacancyFitStage(view)];
  return (
    rank(left) - rank(right) || (vacancyFitPercent(left) ?? 0) - (vacancyFitPercent(right) ?? 0)
  );
}

/** Money in RUB per month; rows without money go last in both directions. */
export function compareMoney(
  left: number | undefined,
  right: number | undefined,
  dir: VacancySortDirection,
): number {
  if (left === undefined || right === undefined) {
    return Number(left === undefined) - Number(right === undefined);
  }
  return dir === 'desc' ? right - left : left - right;
}
