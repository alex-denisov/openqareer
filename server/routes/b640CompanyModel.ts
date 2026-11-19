import type {
  B640CompanyCity,
  B640CompanyItem,
  B640CompanyRelocation,
} from '../../shared/b640Companies';
import type { CandidateCompanyOpportunity } from '../../shared/candidateCompany';
import type { Company } from '../domain/company';

const COMPANY_KEY = /^[a-f0-9]{24}$/u;

/** Ключ из адреса карточки вакансии: название без регистра, знаков и пробелов (как у клиента). */
export function companyLookupKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

/** Компания по ключу адреса: хеш-ключ списка или ключ названия из карточки вакансии. */
export function findCompanyRow<T extends Pick<CandidateCompanyOpportunity, 'key' | 'name'>>(
  rows: readonly T[],
  companyId: string,
): T | undefined {
  if (COMPANY_KEY.test(companyId)) return rows.find((row) => row.key === companyId);
  const wanted = companyLookupKey(companyId);
  return wanted ? rows.find((row) => companyLookupKey(row.name) === wanted) : undefined;
}

/** Заявление о релокации из реестра компаний: только подтверждённое источником значение. */
export function relocationOf(
  company: Pick<Company, 'attributes'> | undefined,
): B640CompanyRelocation | null {
  const claim = company?.attributes.find(
    (attribute) => attribute.key === 'relocation' && attribute.value === true,
  );
  if (!claim) return null;
  const { sourceLabel, readAt } = claim.provenance;
  return { sourceLabel: sourceLabel.trim() || 'реестр компаний', readAt: readAt || null };
}

export function withRelocation(
  rows: readonly CandidateCompanyOpportunity[],
  find: (name: string) => Pick<Company, 'attributes'> | undefined,
): B640CompanyItem[] {
  return rows.map((row) => ({ ...row, relocation: relocationOf(find(row.name)) }));
}

export interface PlaceFilter {
  readonly relocation: boolean;
  readonly city: string | null;
}

export function filterByPlace(
  rows: readonly B640CompanyItem[],
  filter: PlaceFilter,
): B640CompanyItem[] {
  return rows.filter(
    (row) =>
      (!filter.relocation || row.relocation !== null) &&
      (!filter.city || row.location === filter.city),
  );
}

/** Города компаний (после фильтра релокации), по убыванию числа, затем по алфавиту. */
export function citiesOf(rows: readonly B640CompanyItem[]): B640CompanyCity[] {
  const counts = new Map<string, number>();
  for (const row of rows)
    if (row.location) counts.set(row.location, (counts.get(row.location) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru-RU'));
}
