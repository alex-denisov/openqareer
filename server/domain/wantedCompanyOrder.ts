import { candidateCompanyKey } from './candidateCompanies';

interface CompanyOrderItem {
  readonly cluster: { readonly canonicalCompany?: string };
}

/**
 * B422: «Хочу в эту компанию» учитывается подбором — вакансии отмеченных
 * компаний идут первыми. Порядок внутри обеих групп сохраняется.
 */
export function wantedCompaniesFirst<T extends CompanyOrderItem>(
  items: readonly T[],
  wantedKeys: ReadonlySet<string>,
): T[] {
  if (wantedKeys.size === 0) return [...items];
  const isWanted = (item: T) =>
    Boolean(item.cluster.canonicalCompany) &&
    wantedKeys.has(candidateCompanyKey(item.cluster.canonicalCompany!));
  return [...items.filter(isWanted), ...items.filter((item) => !isWanted(item))];
}

/** Ключи компаний «Хочу» кандидата; без хранилища — пусто. */
export function wantedCompanyKeys(
  repo: { list(candidateId: string): readonly { readonly companyKey: string }[] } | undefined,
  candidateId: string,
): Set<string> {
  return new Set((repo?.list(candidateId) ?? []).map((want) => want.companyKey));
}
