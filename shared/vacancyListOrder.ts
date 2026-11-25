/**
 * Порядок подборки (владелец 25.11): показанный процент, затем дата; строки без процента — после
 * посчитанных, не проходящие по условию, затем мёртвые и подозрительные — внизу. У другого столбца он главный, этот порядок — второй.
 */
import type { VacancyFitView } from './vacancyFit';
import { vacancyFitPercent, vacancyFitStage } from './vacancyFitPercent';
import { trustRank, type OrderableMatch } from './vacancyMatchOrder';

export interface ListedMatch {
  readonly cluster: OrderableMatch['cluster'] & {
    readonly id: string;
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

const MAIN_GROUP = 0;
const BLOCKED_GROUP = 1;
const SUNK_GROUP = 2;

/**
 * Основная часть; ниже — вакансии, где профиль прямо не проходит условие (владелец 02.11); в самом
 * низу — мёртвые ссылки и подозрительные.
 */
export function listedGroup(item: ListedMatch): number {
  if (trustRank(item) === 0) return SUNK_GROUP;
  const blocks = item.explanation.fitView?.result?.conditionBlocks?.length ?? 0;
  return blocks > 0 ? BLOCKED_GROUP : MAIN_GROUP;
}

export const compareListedGroup = (left: ListedMatch, right: ListedMatch): number =>
  listedGroup(left) - listedGroup(right);

function compareId(left: ListedMatch, right: ListedMatch): number {
  if (left.cluster.id === right.cluster.id) return 0;
  return left.cluster.id < right.cluster.id ? -1 : 1;
}

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

/** Свежие выше; равные — по id, чтобы после перезапуска порядок не сдвигался. */
export function compareListedDate(left: ListedMatch, right: ListedMatch): number {
  return (listedAt(right) ?? 0) - (listedAt(left) ?? 0) || compareId(left, right);
}

export function compareListed(
  left: ListedMatch,
  right: ListedMatch,
  dir: Direction = 'desc',
  /** Порядок строк без процента: очередь подсчёта идёт по нему. */
  uncounted?: (left: ListedMatch, right: ListedMatch) => number,
): number {
  const fit = compareListedGroup(left, right) || compareListedFit(left, right, dir);
  if (fit) return fit;
  const byRole =
    uncounted && vacancyFitPercent(left.explanation.fitView) === null ? uncounted(left, right) : 0;
  return byRole || compareListedDate(left, right);
}
