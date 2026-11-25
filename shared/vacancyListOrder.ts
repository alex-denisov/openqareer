/**
 * Порядок подборки (владелец 25.11): показанный процент, затем дата; строки без процента — после
 * посчитанных, мёртвые и подозрительные — внизу. У другого столбца он главный, этот порядок — второй.
 */
import type { VacancyFitView } from './vacancyFit';
import { vacancyFitPercent, vacancyFitStage } from './vacancyFitPercent';
import { trustRank, type OrderableMatch } from './vacancyMatchOrder';

export interface ListedMatch {
  readonly cluster: OrderableMatch['cluster'] & {
    readonly sources?: readonly { readonly observedAt?: string }[];
  };
  readonly explanation: OrderableMatch['explanation'] & { readonly fitView?: VacancyFitView };
}

type Direction = 'asc' | 'desc';

/** Дата строки, как её показывает список; нет даты — `undefined`. */
export function listedAt({ cluster }: ListedMatch): number | undefined {
  const time = Date.parse(cluster.sources?.[0]?.observedAt ?? cluster.firstObservedAt ?? '');
  return Number.isNaN(time) ? undefined : time;
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();

function dayFormat(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? '';
  const known = dayFormats.get(key);
  if (known) return known;
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' });
  dayFormats.set(key, format);
  return format;
}

/** День строки: в столбце «Дата» виден он, и внутри дня порядок решает процент. */
export function listedDay(item: ListedMatch, timeZone?: string): string | undefined {
  const time = listedAt(item);
  return time === undefined ? undefined : dayFormat(timeZone).format(time);
}

/** Мёртвая ссылка или подозрительная вакансия. */
export const isSunk = (item: ListedMatch): boolean => trustRank(item) === 0;

export const compareSunk = (left: ListedMatch, right: ListedMatch): number =>
  Number(isSunk(left)) - Number(isSunk(right));

/** Непосчитанные: сначала те, чей процент ещё будет. */
const uncountedRank = ({ explanation }: ListedMatch): number =>
  vacancyFitStage(explanation.fitView) === 'counting' ? 0 : 1;

export function compareListedFit(left: ListedMatch, right: ListedMatch, dir: Direction): number {
  const a = vacancyFitPercent(left.explanation.fitView);
  const b = vacancyFitPercent(right.explanation.fitView);
  if (a !== null && b !== null) return dir === 'desc' ? b - a : a - b;
  if (a !== null || b !== null) return a === null ? 1 : -1;
  return uncountedRank(left) - uncountedRank(right);
}

/** Свежие выше; равные остаются в порядке подбора (сортировка устойчива). */
export function compareListedDate(left: ListedMatch, right: ListedMatch): number {
  return (listedAt(right) ?? 0) - (listedAt(left) ?? 0);
}

export function compareListed(
  left: ListedMatch,
  right: ListedMatch,
  dir: Direction = 'desc',
  /** Порядок строк без процента: очередь подсчёта идёт по нему. */
  uncounted?: (left: ListedMatch, right: ListedMatch) => number,
): number {
  const fit = compareSunk(left, right) || compareListedFit(left, right, dir);
  if (fit) return fit;
  const byRole =
    uncounted && vacancyFitPercent(left.explanation.fitView) === null ? uncounted(left, right) : 0;
  return byRole || compareListedDate(left, right);
}
