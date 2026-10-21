/** B550: фильтр, сортировка и подписи вкладки «Сохранённые» (макет 4, кадр sv). */

export interface SavedVacancySalary {
  readonly from?: number;
  readonly to?: number;
  readonly currency?: string;
}

/** Состояние вакансии на площадке с сервера; `undefined` — сервер ничего не знает. */
export interface SavedVacancyState {
  readonly closed: boolean;
  /** `false` — вакансии нет в текущем каталоге: уровень и гео неизвестны. */
  readonly inCatalog?: boolean;
  readonly closedAt?: string;
  readonly salary?: SavedVacancySalary;
  readonly vacancyLevel?: 'ic' | 'lead' | 'head' | 'vp' | 'c-level';
  readonly levelMatch?: 'match' | 'above' | 'below' | 'unknown';
  readonly location?: string;
  readonly isRemote?: boolean;
  readonly outsideGeography?: boolean;
}

export interface SavedVacancyEntry {
  readonly id: string;
  readonly title: string;
  readonly company: string;
  readonly savedAt: string;
  readonly state?: SavedVacancyState;
}

export type SavedStateFilter = 'all' | 'open' | 'closed';
export type SavedSort = 'saved' | 'money' | 'company';

export interface SavedViewOptions {
  readonly query: string;
  readonly state: SavedStateFilter;
  readonly sort: SavedSort;
}

export const SAVED_STATE_OPTIONS: readonly {
  readonly value: SavedStateFilter;
  readonly label: string;
}[] = [
  { value: 'all', label: 'Все' },
  { value: 'open', label: 'Открытые' },
  { value: 'closed', label: 'Закрылись на площадке' },
];

export const SAVED_SORT_OPTIONS: readonly { readonly value: SavedSort; readonly label: string }[] =
  [
    { value: 'saved', label: 'По дате сохранения' },
    { value: 'money', label: 'По деньгам' },
    { value: 'company', label: 'По компании' },
  ];

function salaryValue(entry: SavedVacancyEntry): number | undefined {
  const salary = entry.state?.salary;
  return salary?.to ?? salary?.from;
}

function timeOf(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

const COMPARATORS: Record<SavedSort, (a: SavedVacancyEntry, b: SavedVacancyEntry) => number> = {
  saved: (a, b) => timeOf(b.savedAt) - timeOf(a.savedAt),
  money: (a, b) => {
    const left = salaryValue(a);
    const right = salaryValue(b);
    if (left === undefined || right === undefined) {
      return left === right ? timeOf(b.savedAt) - timeOf(a.savedAt) : left === undefined ? 1 : -1;
    }
    return right - left;
  },
  company: (a, b) => a.company.localeCompare(b.company, 'ru-RU'),
};

function matchesState(entry: SavedVacancyEntry, state: SavedStateFilter): boolean {
  if (state === 'all') return true;
  const closed = entry.state?.closed === true;
  return state === 'closed' ? closed : !closed;
}

export function savedVacanciesView(
  items: readonly SavedVacancyEntry[],
  options: SavedViewOptions,
): readonly SavedVacancyEntry[] {
  const query = options.query.trim().toLocaleLowerCase('ru-RU');
  return items
    .filter((item) => matchesState(item, options.state))
    .filter((item) => `${item.title} ${item.company}`.toLocaleLowerCase('ru-RU').includes(query))
    .sort(COMPARATORS[options.sort]);
}

export function formatShortDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}`;
}

export function savedClosedLabel(state: SavedVacancyState | undefined): string | undefined {
  if (!state?.closed) return undefined;
  const date = formatShortDate(state.closedAt);
  return date ? `закрыта на площадке ${date}` : 'закрыта на площадке';
}
