import type { CurrencyRates } from '../../../../../shared/currencyRates';
import { workFormatLabel, type VacancyWorkFormat } from '../../../../../shared/vacancyWorkFormat';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import type { VacanciesScreenState } from '../../../vacancies/vacanciesScreenState';
import {
  filterByScreenState,
  normalizeSalaryCurrency,
  vacancyFormat,
} from '../../../vacancies/vacancyScreenCriteria';
import type { ServerMoney } from '../b640Api';
import type { MoneyCurrency } from '../format';
import { roleLabel, type RoleTitlesRu } from '../../career/roleLabel';

export type FilterKind = 'roles' | 'locations' | 'formats' | 'money' | 'dates';
export type DateId = 'any' | 'today' | '7' | '30' | '90';

export const FILTER_KINDS: ReadonlyArray<{
  readonly kind: FilterKind;
  readonly name: string;
  readonly search: string;
}> = [
  { kind: 'roles', name: 'Роли', search: 'роли' },
  { kind: 'locations', name: 'Локации', search: 'локации' },
  { kind: 'formats', name: 'Формат', search: 'формат' },
  { kind: 'money', name: 'Деньги', search: 'деньги' },
  { kind: 'dates', name: 'Дата', search: 'дату' },
];

export const DATE_OPTIONS: ReadonlyArray<{
  readonly id: DateId;
  readonly label: string;
  readonly days?: number;
}> = [
  { id: 'any', label: 'Любая' },
  { id: 'today', label: 'сегодня', days: 0 },
  { id: '7', label: '7 дней', days: 7 },
  { id: '30', label: '30 дней', days: 30 },
  { id: '90', label: '90 дней', days: 90 },
];

export const FORMAT_IDS: readonly VacancyWorkFormat[] = ['remote', 'hybrid', 'office'];
/** Значение «Локаций» для удалённых вакансий. */
export const REMOTE_LOCATION = 'Удалённо';

export const CURRENCY_OPTIONS: ReadonlyArray<{
  readonly code: MoneyCurrency;
  readonly label: string;
  readonly aria?: string;
}> = [
  { code: 'RUB', label: '₽', aria: 'рубли' },
  { code: 'USD', label: '$', aria: 'доллары' },
  { code: 'EUR', label: '€', aria: 'евро' },
  { code: 'AED', label: 'AED', aria: 'дирхамы' },
  { code: 'ORIG', label: 'Как в вакансии' },
];

export interface ListFilters {
  readonly roles: readonly string[];
  readonly locations: readonly string[];
  readonly formats: readonly string[];
  readonly reloc: boolean;
  /** Порог «Зарплата от» в тысячах; `null` — не задан. */
  readonly moneyFrom: number | null;
  readonly date: DateId;
}

export const EMPTY_FILTERS: ListFilters = {
  roles: [],
  locations: [],
  formats: [],
  reloc: false,
  moneyFrom: null,
  date: 'any',
};

export function formatLabel(id: string): string {
  return workFormatLabel(id as VacancyWorkFormat) ?? id;
}

export function dateLabel(id: DateId): string {
  return DATE_OPTIONS.find((option) => option.id === id)?.label ?? 'Любая';
}

export function currencySymbol(currency: MoneyCurrency): string {
  if (currency === 'ORIG' || currency === 'RUB') return '₽';
  return currency === 'USD' ? '$' : currency === 'EUR' ? '€' : 'AED';
}

function currencyWord(currency: MoneyCurrency): string {
  return CURRENCY_OPTIONS.find((option) => option.code === currency)?.label ?? '₽';
}

/** Подпись кнопки фильтра (`label_of` макета). */
export function labelOf(kind: FilterKind, filters: ListFilters, currency: MoneyCurrency): string {
  const name = FILTER_KINDS.find((entry) => entry.kind === kind)?.name ?? '';
  if (kind === 'money') {
    return filters.moneyFrom === null
      ? `${name} · ${currencyWord(currency)}`
      : `${name} · от ${filters.moneyFrom} тыс. ${currencySymbol(currency)}`;
  }
  if (kind === 'dates') return filters.date === 'any' ? name : `${name} · ${dateLabel(filters.date)}`;
  if (kind === 'roles') {
    return filters.roles.length === 0 ? 'Все роли' : `${name}: выбрано ${filters.roles.length}`;
  }
  const count = kind === 'locations' ? filters.locations.length : filters.formats.length + Number(filters.reloc);
  return count > 0 ? `${name} · ${count}` : name;
}

/** Число в «Фильтры · N» на 390: выбранные значения, дата — всегда одно значение. */
export function activeCount(filters: ListFilters): number {
  return (
    filters.roles.length +
    filters.locations.length +
    filters.formats.length +
    (filters.moneyFrom === null ? 0 : 1) +
    1
  );
}

export interface FilterChip {
  readonly kind: FilterKind;
  readonly id: string;
  readonly label: string;
}

export const CHIP_LIMIT = 3;

export function chipsOf(
  filters: ListFilters,
  currency: MoneyCurrency,
  titlesRu: RoleTitlesRu = {},
): readonly FilterChip[] {
  const symbol = currencySymbol(currency);
  return [
    ...filters.roles.map((id) => ({ kind: 'roles' as const, id, label: roleLabel(id, titlesRu) })),
    ...filters.locations.map((id) => ({ kind: 'locations' as const, id, label: id })),
    ...filters.formats.map((id) => ({ kind: 'formats' as const, id, label: formatLabel(id) })),
    ...(filters.moneyFrom === null
      ? []
      : [{ kind: 'money' as const, id: 'money', label: `от ${filters.moneyFrom} тыс. ${symbol}` }]),
    ...(filters.date === 'any'
      ? []
      : [{ kind: 'dates' as const, id: 'date', label: `Дата: ${dateLabel(filters.date)}` }]),
  ];
}

export function hasChosen(filters: ListFilters): boolean {
  return chipsOf(filters, 'RUB').length > 0 || filters.reloc;
}

/** Фильтры без одного вида (для «Снять: …»). */
export function withoutKind(filters: ListFilters, kind: FilterKind | 'reloc'): ListFilters {
  switch (kind) {
    case 'roles':
      return { ...filters, roles: [] };
    case 'locations':
      return { ...filters, locations: [] };
    case 'formats':
      return { ...filters, formats: [] };
    case 'reloc':
      return { ...filters, reloc: false };
    case 'money':
      return { ...filters, moneyFrom: null };
    default:
      return { ...filters, date: 'any' };
  }
}

export function withoutChip(filters: ListFilters, chip: FilterChip): ListFilters {
  switch (chip.kind) {
    case 'roles':
      return { ...filters, roles: filters.roles.filter((id) => id !== chip.id) };
    case 'locations':
      return { ...filters, locations: filters.locations.filter((id) => id !== chip.id) };
    case 'formats':
      return { ...filters, formats: filters.formats.filter((id) => id !== chip.id) };
    default:
      return withoutKind(filters, chip.kind);
  }
}

export function toggleValue(values: readonly string[], id: string): readonly string[] {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
}

function observedAt(item: MatchedVacancyItem): number {
  return Date.parse(item.cluster.sources[0]?.observedAt ?? item.cluster.firstObservedAt);
}

function matchesDate(item: MatchedVacancyItem, date: DateId, now: Date): boolean {
  const days = DATE_OPTIONS.find((option) => option.id === date)?.days;
  if (days === undefined) return true;
  const at = observedAt(item);
  if (Number.isNaN(at)) return false;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return at >= start.getTime() - days * 86_400_000;
}

function matchesLocations(item: MatchedVacancyItem, locations: readonly string[]): boolean {
  if (locations.length === 0) return true;
  if (item.cluster.isRemote && locations.includes(REMOTE_LOCATION)) return true;
  return locations.includes(item.cluster.canonicalLocation?.trim() ?? '');
}

function salaryState(filters: ListFilters, currency: MoneyCurrency): VacanciesScreenState {
  const base: VacanciesScreenState = { roles: [], regions: [], remoteOnly: false };
  if (filters.moneyFrom === null) return base;
  return {
    ...base,
    salaryMinimum: filters.moneyFrom * 1000,
    // B645 s07: a vacancy without a salary stays in the list as «не указана», as in the mockup.
    includeMissingSalary: true,
    salaryCurrency: normalizeSalaryCurrency(currency === 'ORIG' ? 'RUB' : currency),
  };
}

/**
 * B765 (B645 s07): «Зарплата от» в серверном порядке режет и считает сервер — то же правило, что у
 * клиента (shared/monthlySalaryMinimum), и «Показать N» знает число сразу. Без порога — `null`.
 */
export function serverMoney(filters: ListFilters, currency: MoneyCurrency): ServerMoney | null {
  if (filters.moneyFrom === null) return null;
  return { from: filters.moneyFrom * 1000, currency: currency === 'ORIG' ? 'RUB' : currency };
}

/** Фильтры, которые считает клиент по загруженным строкам; роли читает сервер. */
export function applyFilters(
  items: readonly MatchedVacancyItem[],
  filters: ListFilters,
  context: { readonly currency: MoneyCurrency; readonly rates?: CurrencyRates; readonly now: Date },
): MatchedVacancyItem[] {
  const byMoney = filterByScreenState(
    items,
    salaryState(filters, context.currency),
    context.now.toISOString(),
    context.rates,
  );
  return byMoney.filter(
    (item) =>
      matchesLocations(item, filters.locations) &&
      (filters.formats.length === 0 || filters.formats.includes(vacancyFormat(item))) &&
      (!filters.reloc || item.cluster.companyFeatures?.relocation === true) &&
      matchesDate(item, filters.date, context.now),
  );
}

export interface Blocker {
  readonly kind: FilterKind | 'reloc';
  readonly label: string;
}

function activeKinds(filters: ListFilters, currency: MoneyCurrency): readonly Blocker[] {
  const quoted = (name: string, values: readonly string[]) => `${name} «${values.join(', ')}»`;
  return [
    ...(filters.roles.length ? [{ kind: 'roles' as const, label: quoted('Роль', filters.roles) }] : []),
    ...(filters.locations.length
      ? [{ kind: 'locations' as const, label: quoted('Локация', filters.locations) }]
      : []),
    ...(filters.formats.length
      ? [{ kind: 'formats' as const, label: quoted('Формат', filters.formats.map(formatLabel)) }]
      : []),
    ...(filters.reloc ? [{ kind: 'reloc' as const, label: 'Релокация' }] : []),
    ...(filters.moneyFrom !== null
      ? [{ kind: 'money' as const, label: `Деньги от ${filters.moneyFrom} тыс. ${currencySymbol(currency)}` }]
      : []),
    ...(filters.date !== 'any' ? [{ kind: 'dates' as const, label: `Дата: ${dateLabel(filters.date)}` }] : []),
  ];
}

/** Фильтры, без которых что-то нашлось бы; если такого нет — все выбранные. */
export function blockersOf(
  items: readonly MatchedVacancyItem[],
  filters: ListFilters,
  context: { readonly currency: MoneyCurrency; readonly rates?: CurrencyRates; readonly now: Date },
): readonly Blocker[] {
  const active = activeKinds(filters, context.currency);
  const freeing = active.filter(
    (entry) =>
      entry.kind === 'roles' ||
      applyFilters(items, withoutKind(filters, entry.kind), context).length > 0,
  );
  return freeing.length > 0 ? freeing : active;
}
