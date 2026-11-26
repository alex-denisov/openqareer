/**
 * B706: значение фильтра источника — либо точный sourceId, либо семейство площадки.
 * Семейство «hh» охватывает sourceId «hh» и «src-hh-*» (поиск и RSS hh.ru): в подборке
 * вакансии hh.ru лежат под «src-hh-search», а фильтр и ссылки шлют «hh».
 */
const FAMILY_PREFIX = 'src-';

function familyOf(sourceId: string): string | undefined {
  if (!sourceId.startsWith(FAMILY_PREFIX)) return undefined;
  const rest = sourceId.slice(FAMILY_PREFIX.length);
  const dash = rest.indexOf('-');
  return dash > 0 ? rest.slice(0, dash) : undefined;
}

/** Совпадает ли источник вакансии хотя бы с одним значением фильтра. */
export function sourceFilterMatches(filterValues: readonly string[], sourceId: string): boolean {
  const family = familyOf(sourceId);
  return filterValues.some((value) => value === sourceId || (family !== undefined && value === family));
}

/** Значения фильтра, которые принимаются без реестра: семейства известных sourceId. */
export function sourceFamilies(sourceIds: Iterable<string>): string[] {
  const families = new Set<string>();
  for (const sourceId of sourceIds) {
    const family = familyOf(sourceId);
    if (family) families.add(family);
  }
  return [...families];
}
