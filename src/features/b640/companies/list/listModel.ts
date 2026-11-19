import type {
  CandidateCompanyFilter,
  CandidateCompanyOpportunity,
  CandidateCompanyPage,
  CandidateCompanySort,
} from '../../../../../shared/candidateCompany';

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
export function filterChips(counts: CandidateCompanyPage['filterCounts'] | undefined): FilterChip[] {
  if (!counts) return [];
  const chips: FilterChip[] = [{ id: 'want', label: 'Хочу', count: counts.want }];
  if (counts.contacts !== null) chips.push({ id: 'contacts', label: 'Есть контакты в сети', count: counts.contacts });
  chips.push({ id: 'recruiter', label: 'Рекрутер известен', count: counts.recruiter });
  return chips;
}

/** Строка после отметки «Хочу»: новая копия, остальные строки те же. */
export function withWant(
  items: readonly CandidateCompanyOpportunity[],
  key: string,
  want: boolean,
): CandidateCompanyOpportunity[] {
  return items.map((item) => (item.key === key ? { ...item, want } : item));
}

/** Число «Хочу» в фильтре меняется вместе с отметкой. */
export function withWantCount(
  counts: CandidateCompanyPage['filterCounts'],
  delta: number,
): CandidateCompanyPage['filterCounts'] {
  return { ...counts, want: Math.max(0, counts.want + delta) };
}

/** Следующая порция без повторов: строка, уже показанная выше, не дублируется. */
export function appendPage(
  items: readonly CandidateCompanyOpportunity[],
  next: readonly CandidateCompanyOpportunity[],
): CandidateCompanyOpportunity[] {
  const known = new Set(items.map((item) => item.key));
  return [...items, ...next.filter((item) => !known.has(item.key))];
}
