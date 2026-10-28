import { candidateCompanyKey } from './candidateCompanies';

interface CompanyOrderItem {
  readonly cluster: { readonly canonicalCompany?: string };
}

/**
 * 28.10: порядок «по совпадению» ведёт процент; отметка «Хочу» поднимает вакансию
 * только среди вакансий с тем же местом по `samePlace`. Сортировка устойчива.
 */
export function wantedCompaniesBreakTies<T extends CompanyOrderItem>(
  items: readonly T[],
  wantedKeys: ReadonlySet<string>,
  samePlace: (left: T, right: T) => number,
): T[] {
  if (wantedKeys.size === 0) return [...items];
  const rank = (item: T) =>
    item.cluster.canonicalCompany &&
    wantedKeys.has(candidateCompanyKey(item.cluster.canonicalCompany))
      ? 0
      : 1;
  return [...items].sort((left, right) => samePlace(left, right) || rank(left) - rank(right));
}

/** Ключи компаний «Хочу» кандидата; без хранилища — пусто. */
export function wantedCompanyKeys(
  repo: { list(candidateId: string): readonly { readonly companyKey: string }[] } | undefined,
  candidateId: string,
): Set<string> {
  return new Set((repo?.list(candidateId) ?? []).map((want) => want.companyKey));
}
