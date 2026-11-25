import { convertAmount, type CurrencyRates } from '../../../../../shared/currencyRates';
import {
  compareListed,
  compareListedDate,
  compareListedFit,
  compareSunk,
  listedDay,
} from '../../../../../shared/vacancyListOrder';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';

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

/** Порядок подборки s07 по умолчанию (владелец 25.11): процент, затем дата. */
export const DEFAULT_LIST_SORT: SortState = SERVER_SORT;

/**
 * Порядок столбца за подборку, прочитанную не целиком, отдаёт сервер. Пока читается первая порция
 * или чтение сорвалось, строки показываем из пула: второго запроса порции до этого не шлём.
 */
export function serverSortApplies(pool: {
  readonly complete: boolean;
  readonly loading: boolean;
  readonly failed: boolean;
}): boolean {
  return !pool.complete && !pool.loading && !pool.failed;
}

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

function textValue(item: MatchedVacancyItem, key: SortKey): string {
  const { cluster } = item;
  if (key === 'role') return cluster.canonicalTitle;
  if (key === 'company') return cluster.canonicalCompany ?? '';
  if (key === 'geo') return cluster.canonicalLocation ?? '';
  return cluster.workFormat ?? '';
}

function compareColumn(
  left: MatchedVacancyItem,
  right: MatchedVacancyItem,
  sort: SortState,
  rates?: CurrencyRates,
): number {
  const sign = sort.dir === 'asc' ? 1 : -1;
  if (sort.key === 'fit') return compareListedFit(left, right, sort.dir);
  if (sort.key !== 'money' && sort.key !== 'date') {
    return sign * textValue(left, sort.key).localeCompare(textValue(right, sort.key), 'ru-RU');
  }
  const value = (item: MatchedVacancyItem) =>
    sort.key === 'money' ? moneyValue(item, rates) : listedDay(item);
  const a = value(left);
  const b = value(right);
  if (a === b) return 0;
  if (a === undefined || b === undefined) return a === undefined ? 1 : -1;
  return sign * (a < b ? -1 : 1);
}

/** Столбец главный; второй ключ — процент и дата, у «Совпадения» — дата. */
function compare(
  left: MatchedVacancyItem,
  right: MatchedVacancyItem,
  sort: SortState,
  rates?: CurrencyRates,
): number {
  return (
    compareSunk(left, right) ||
    compareColumn(left, right, sort, rates) ||
    (sort.key === 'fit' ? compareListedDate(left, right) : compareListed(left, right))
  );
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
export function footOf(
  total: number,
  shown: number,
): { readonly step: number; readonly left: number } | null {
  const left = total - shown;
  return left > 0 ? { step: Math.min(PAGE_SIZE, left), left } : null;
}

/**
 * Подвал и число в шапке в серверном режиме. Клиентские фильтры режут уже прочитанные строки,
 * а сколько подходящих в непрочитанном, неизвестно: число не пишем и шапку не занижаем.
 */
export function serverFoot(input: {
  readonly narrowed: boolean;
  readonly hasMore: boolean;
  readonly serverTotal: number;
  readonly loaded: number;
}): { readonly total: number | null; readonly shown: number; readonly countKnown: boolean } {
  const { narrowed, hasMore, serverTotal, loaded } = input;
  if (!hasMore) return { total: loaded, shown: loaded, countKnown: true };
  if (narrowed) return { total: null, shown: loaded, countKnown: false };
  return { total: serverTotal, shown: loaded, countKnown: true };
}
