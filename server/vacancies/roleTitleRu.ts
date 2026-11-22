import { ontology } from '../../shared/roleOntology';

const keyOf = (title: string): string => title.trim().toLocaleLowerCase('en');

/**
 * B737: роль поиска хранится английским названием онтологии — это ключ подбора и проверки.
 * Показывать её кандидату по-русски: titleEn роли, затем английский вариант, если он
 * принадлежит одной роли. Двусмысленный вариант не переводим.
 */
function buildIndex(): ReadonlyMap<string, string> {
  const byTitle = new Map<string, string>();
  const variants = new Map<string, Set<string>>();
  for (const role of ontology.roles) {
    if (!role.titleRu) continue;
    byTitle.set(keyOf(role.titleEn), role.titleRu);
    for (const variant of role.variants.en) {
      const owners = variants.get(keyOf(variant)) ?? new Set<string>();
      owners.add(role.titleRu);
      variants.set(keyOf(variant), owners);
    }
  }
  const index = new Map<string, string>();
  for (const [key, owners] of variants) if (owners.size === 1) index.set(key, [...owners][0]!);
  for (const [key, titleRu] of byTitle) index.set(key, titleRu);
  return index;
}

const INDEX = buildIndex();

export function roleTitleRu(title: string): string {
  return INDEX.get(keyOf(title)) ?? title;
}

/** Только названия, у которых есть русское: клиент показывает `titlesRu[title] ?? title`. */
export function roleTitlesRu(titles: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    titles
      .map((title) => [title, roleTitleRu(title)] as const)
      .filter(([title, ru]) => ru !== title),
  );
}
