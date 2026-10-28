/**
 * B574: filter chips of a catalog list (mockup 08) and the relocation list.
 *
 * Every chip is decided from the fields `catalog_entries` already stores:
 * the salary label, the remote flag, the publication time and the title with
 * its short summary. Matching parses labels and text, so it runs in the
 * maintenance process (`catalogChipStore.ts`); a request reads the result.
 */
import { parseSalaryLabel } from './catalogSalaryStats';

export type CatalogChip =
  'salary' | 'from-100k' | 'remote' | 'fresh' | 'no-experience' | 'relocation';

/** Chips of a list page, in the order of mockup 08. */
export const LISTING_CHIPS: readonly { readonly id: CatalogChip; readonly label: string }[] = [
  { id: 'salary', label: 'С зарплатой' },
  { id: 'from-100k', label: 'от 100 000 ₽' },
  { id: 'remote', label: 'Удалённо или гибрид' },
  { id: 'fresh', label: 'За последние 3 дня' },
  { id: 'no-experience', label: 'Без опыта' },
];

/** `/vacancies/relocation` is a list over the whole catalog, not a place. */
export const RELOCATION_PLACE = 'relocation';
export const RELOCATION_LIST_KEY = '';

export const FRESH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const SALARY_FLOOR = 100_000;

const HYBRID = /гибрид|hybrid/iu;
const NO_EXPERIENCE =
  /без опыта|опыт(?: работы)? не (?:требуется|обязателен|нужен)|не требуется опыт|стаж[её]р|no experience|internship|\bintern\b|trainee/iu;
const RELOCATION = /релокац|relocation|visa sponsorship/iu;

export interface ChipFields {
  readonly isRemote: boolean;
  readonly salaryLabel?: string | null;
  readonly title: string;
  readonly summary: string;
  readonly publishedMs: number;
}

/** «от 100 000 ₽»: a rouble salary whose upper end reaches the floor. */
function salaryFrom100k(label: string | null | undefined): boolean {
  if (!label) return false;
  const parsed = parseSalaryLabel(label);
  if (!parsed || parsed.sign !== '₽') return false;
  return (parsed.to ?? parsed.from ?? 0) >= SALARY_FLOOR;
}

export function chipMatches(chip: CatalogChip, entry: ChipFields, nowMs: number): boolean {
  const text = `${entry.title} ${entry.summary}`;
  switch (chip) {
    case 'salary':
      return Boolean(entry.salaryLabel?.trim());
    case 'from-100k':
      return salaryFrom100k(entry.salaryLabel);
    case 'remote':
      return entry.isRemote || HYBRID.test(text);
    case 'fresh':
      return entry.publishedMs >= nowMs - FRESH_WINDOW_MS;
    case 'no-experience':
      return NO_EXPERIENCE.test(text);
    case 'relocation':
      return RELOCATION.test(text);
  }
}

/** `?f=` of a list page; anything else is no filter. */
export function parseListingChip(raw: unknown): CatalogChip | undefined {
  return typeof raw === 'string' ? LISTING_CHIPS.find((chip) => chip.id === raw)?.id : undefined;
}

export type ChipCounts = Partial<Record<CatalogChip, number>>;
