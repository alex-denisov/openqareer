import type { B640CompanyPage } from '../../../../../shared/b640Companies';
import type {
  CandidateCompanyFilter,
  CandidateCompanyOpportunity,
  CandidateCompanySort,
} from '../../../../../shared/candidateCompany';

type Counts = B640CompanyPage['filterCounts'];

export const SORT_OPTIONS: ReadonlyArray<{ readonly id: CandidateCompanySort; readonly label: string }> = [
  { id: 'default', label: 'По вакансиям' },
  { id: 'contacts', label: 'По контактам в сети' },
  { id: 'alphabetical', label: 'По алфавиту' },
];

export interface FilterChip {
  readonly id: Exclude<CandidateCompanyFilter, 'all'>;
  readonly label: string;
  readonly count: number;
}

/** Быстрые фильтры макета с числом; фильтр без посчитанного числа не показывается. */
export function filterChips(counts: Counts | undefined): FilterChip[] {
  if (!counts) return [];
  const chips: FilterChip[] = [{ id: 'want', label: 'Хочу', count: counts.want }];
  if (counts.contacts !== null) chips.push({ id: 'contacts', label: 'Есть контакты в сети', count: counts.contacts });
  chips.push({ id: 'recruiter', label: 'Рекрутер известен', count: counts.recruiter });
  return chips;
}

/** Строка после отметки «Хочу»: новая копия, остальные строки те же. */
export function withWant<T extends CandidateCompanyOpportunity>(items: readonly T[], key: string, want: boolean): T[] {
  return items.map((item) => (item.key === key ? { ...item, want } : item));
}

/** Число «Хочу» в фильтре меняется вместе с отметкой. */
export function withWantCount(
  counts: Counts,
  delta: number,
): Counts {
  return { ...counts, want: Math.max(0, counts.want + delta) };
}

/** Следующая порция без повторов: строка, уже показанная выше, не дублируется. */
export function appendPage<T extends CandidateCompanyOpportunity>(items: readonly T[], next: readonly T[]): T[] {
  const known = new Set(items.map((item) => item.key));
  return [...items, ...next.filter((item) => !known.has(item.key))];
}

export interface PlaceChip {
  readonly id: 'relocation' | 'city';
  readonly label: string;
}

/** Выбранные в «Фильтрах» релокация и город — снимаемые чипы над таблицей. */
export function placeChips(place: { readonly relocation: boolean; readonly city: string | null }): PlaceChip[] {
  const chips: PlaceChip[] = [];
  if (place.relocation) chips.push({ id: 'relocation', label: 'Релокация' });
  if (place.city) chips.push({ id: 'city', label: place.city });
  return chips;
}
