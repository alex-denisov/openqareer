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

/** Проверенные русские названия ролей одного кандидата: название → перевод. */
export type OwnTitlesRu = Readonly<Record<string, string>>;

/** B767: модель оставляла латинское «AI» («AI-консультант»); в русском названии — «ИИ». */
const LATIN_AI = /(?<!\p{L})AI(?!\p{L})/gu;

function ownTitleRu(own: OwnTitlesRu, key: string): string | undefined {
  for (const [title, titleRu] of Object.entries(own))
    if (keyOf(title) === key) return titleRu.replace(LATIN_AI, 'ИИ');
  return undefined;
}

/**
 * B748: роли, придуманные моделью, в онтологии нет. Их проверенный русский перевод
 * хранится у ролей самого кандидата и приходит сюда аргументом: вывод модели по
 * одному профилю не становится названием роли для других. Онтология важнее.
 */
export function roleTitleRu(title: string, own: OwnTitlesRu = {}): string {
  const key = keyOf(title);
  return INDEX.get(key) ?? ownTitleRu(own, key) ?? title;
}

/** Только названия, у которых есть русское: клиент показывает `titlesRu[title] ?? title`. */
export function roleTitlesRu(
  titles: readonly string[],
  own: OwnTitlesRu = {},
): Record<string, string> {
  return Object.fromEntries(
    titles
      .map((title) => [title, roleTitleRu(title, own)] as const)
      .filter(([title, ru]) => ru !== title),
  );
}
