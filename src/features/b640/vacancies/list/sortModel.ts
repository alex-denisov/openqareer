import { convertAmount, type CurrencyRates } from '../../../../../shared/currencyRates';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { vacancyFitMark } from '../../../vacancies/vacancyFitModel';

export type SortKey = 'role' | 'company' | 'money' | 'fit' | 'geo' | 'format' | 'date';
export type SortDir = 'asc' | 'desc';
export interface SortState {
  readonly key: SortKey;
  readonly dir: SortDir;
}

export const SORT_COLUMNS: ReadonlyArray<{ readonly key: SortKey; readonly label: string }> = [
  { key: 'role', label: 'Роль' },
  { key: 'company', label: 'Компания' },
  { key: 'money', label: 'Деньги' },
  { key: 'fit', label: 'Совпадение' },
  { key: 'geo', label: 'Локация' },
  { key: 'format', label: 'Формат' },
  { key: 'date', label: 'Дата' },
];

export const PAGE_SIZE = 20;
const DESC_FIRST: readonly SortKey[] = ['money', 'fit', 'date'];

/** Порядок сервера: совпадение по убыванию. */
export const SERVER_SORT: SortState = { key: 'fit', dir: 'desc' };

/** Первое нажатие — естественное направление столбца, повторное — обратное. */
export function nextSort(current: SortState | null, key: SortKey): SortState {
  if (current?.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: DESC_FIRST.includes(key) ? 'desc' : 'asc' };
}

function moneyValue(item: MatchedVacancyItem, rates?: CurrencyRates): number | undefined {
  const salary = item.cluster.salary;
  const amount = salary?.from ?? salary?.to;
  if (amount === undefined || !salary?.currency) return undefined;
  return convertAmount(amount, salary.currency, 'RUB', rates) ?? amount;
}

function dateValue(item: MatchedVacancyItem): number | undefined {
  const time = Date.parse(item.cluster.sources[0]?.observedAt ?? item.cluster.firstObservedAt);
  return Number.isNaN(time) ? undefined : time;
}

function fitValue(item: MatchedVacancyItem): number | undefined {
  const mark = vacancyFitMark(item.explanation.fitView);
  return mark.kind === 'number' ? mark.percent : undefined;
}

function textValue(item: MatchedVacancyItem, key: SortKey): string {
  const { cluster } = item;
  if (key === 'role') return cluster.canonicalTitle;
  if (key === 'company') return cluster.canonicalCompany ?? '';
  if (key === 'geo') return cluster.canonicalLocation ?? '';
  return cluster.workFormat ?? '';
}

function numberValue(
  item: MatchedVacancyItem,
  key: SortKey,
  rates?: CurrencyRates,
): number | undefined {
  if (key === 'money') return moneyValue(item, rates);
  if (key === 'fit') return fitValue(item);
  return dateValue(item);
}

const NUMERIC: readonly SortKey[] = ['money', 'fit', 'date'];

function compare(
  left: MatchedVacancyItem,
  right: MatchedVacancyItem,
  sort: SortState,
  rates?: CurrencyRates,
): number {
  const sign = sort.dir === 'asc' ? 1 : -1;
  if (!NUMERIC.includes(sort.key)) {
    return (
      sign * textValue(left, sort.key).localeCompare(textValue(right, sort.key), 'ru-RU')
    );
  }
  const a = numberValue(left, sort.key, rates);
  const b = numberValue(right, sort.key, rates);
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
  return sign * (a - b);
}

/** Копия по столбцу; строки без значения всегда внизу; `null` — порядок сервера. */
export function sortItems(
  items: readonly MatchedVacancyItem[],
  sort: SortState | null,
  rates?: CurrencyRates,
): MatchedVacancyItem[] {
  if (!sort) return [...items];
  return [...items].sort((left, right) => compare(left, right, sort, rates));
}

export function visibleSlice<T>(items: readonly T[], shown: number): readonly T[] {
  return items.slice(0, shown);
}

/** Подвал «Показать ещё 20 · осталось N»; всё показано — `null`. */
export function footOf(total: number, shown: number): { readonly step: number; readonly left: number } | null {
  const left = total - shown;
  return left > 0 ? { step: Math.min(PAGE_SIZE, left), left } : null;
}
