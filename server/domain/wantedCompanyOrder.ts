/** Ключи компаний «Хочу» кандидата; без хранилища — пусто. */
export function wantedCompanyKeys(
  repo: { list(candidateId: string): readonly { readonly companyKey: string }[] } | undefined,
  candidateId: string,
): Set<string> {
  return new Set((repo?.list(candidateId) ?? []).map((want) => want.companyKey));
}
