import type {
  B640ContactFacets,
  B640ContactLink,
  B640ContactSort,
  B640ContactState,
  B640ContactStatus,
} from '../../../../../shared/b640Contacts';

export type ContactKind = 'company' | 'link' | 'status';

export interface ContactFilters {
  readonly company: readonly string[];
  readonly link: readonly B640ContactLink[];
  readonly status: readonly B640ContactState[];
}

export const EMPTY_FILTERS: ContactFilters = { company: [], link: [], status: [] };

export const KIND_LABELS: Readonly<Record<ContactKind, string>> = { company: 'Компания', link: 'Связь', status: 'Статус' };
export const KINDS: readonly ContactKind[] = ['company', 'link', 'status'];

export const LINK_LABELS: Readonly<Record<B640ContactLink, string>> = {
  direct: 'Знакомы',
  intro: 'Через знакомого',
  none: 'Нет общих',
};
export const STATE_LABELS: Readonly<Record<B640ContactState, string>> = {
  none: 'Не писали',
  written: 'Писали',
  replied: 'Ответили',
};
export const SORT_OPTIONS: ReadonlyArray<{ readonly id: B640ContactSort; readonly label: string }> = [
  { id: 'selection', label: 'Сначала: компании из подборки' },
  { id: 'recent', label: 'Сначала: по последнему контакту' },
  { id: 'name', label: 'Сначала: по имени' },
];

export interface ContactChip {
  readonly kind: ContactKind;
  readonly id: string;
  readonly label: string;
}

export const toggleValue = <T,>(list: readonly T[], value: T): readonly T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

export function chipsOf(filters: ContactFilters): readonly ContactChip[] {
  return [
    ...filters.company.map((id) => ({ kind: 'company' as const, id, label: id })),
    ...filters.link.map((id) => ({ kind: 'link' as const, id, label: LINK_LABELS[id] })),
    ...filters.status.map((id) => ({ kind: 'status' as const, id, label: STATE_LABELS[id] })),
  ];
}

export function withoutChip(filters: ContactFilters, chip: ContactChip): ContactFilters {
  return { ...filters, [chip.kind]: (filters[chip.kind] as readonly string[]).filter((id) => id !== chip.id) };
}

export const activeCount = (filters: ContactFilters): number => chipsOf(filters).length;

/** Подпись кнопки фильтра: «Компания» или «Компания · 2». */
export function kindLabel(kind: ContactKind, filters: ContactFilters): string {
  const count = filters[kind].length;
  return count > 0 ? `${KIND_LABELS[kind]} · ${count}` : KIND_LABELS[kind];
}

const DAY = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow' });

/** Метка статуса в строке: «не писали», «писали 12.11», «ответил». */
export function statusTag(status: B640ContactStatus): { readonly cls: string; readonly text: string } {
  if (status.state === 'replied') return { cls: 'tag ok', text: 'ответил' };
  if (status.state === 'none') return { cls: 'tag', text: 'не писали' };
  const time = status.at ? Date.parse(status.at) : Number.NaN;
  return { cls: 'tag part', text: Number.isFinite(time) ? `писали ${DAY.format(new Date(time))}` : 'писали' };
}

/** Счётчики статусов после смены у одного контакта. */
export function moveStatusFacets(facets: B640ContactFacets, from: B640ContactState, to: B640ContactState): B640ContactFacets {
  if (from === to) return facets;
  return {
    ...facets,
    status: { ...facets.status, [from]: Math.max(0, facets.status[from] - 1), [to]: facets.status[to] + 1 },
  };
}
