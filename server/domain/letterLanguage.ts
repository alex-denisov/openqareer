import { ontology } from '../../shared/roleOntology';

/**
 * Письмо пишется на одном языке (G3 L1, 03.11): русские должность и компания
 * в английском письме читаются рекрутером как ошибка. Шаблон не зовёт модель,
 * поэтому перевод детерминированный: должность — только по точному совпадению
 * со словарём ролей, компания и имя — транслитерацией (так их пишут в
 * английском резюме). Должность без перевода опускается, а не транслитерируется.
 */

const CYRILLIC = /\p{Script=Cyrillic}/u;

const LATIN: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

export function hasCyrillic(text: string): boolean {
  return CYRILLIC.test(text);
}

/** Транслитерация с сохранением регистра: «Маркет Софт» → «Market Soft». */
export function latinize(text: string): string {
  return Array.from(text, (char) => {
    const lower = char.toLocaleLowerCase('ru');
    const latin = LATIN[lower];
    if (latin === undefined) return char;
    return char === lower || !latin ? latin : latin.charAt(0).toUpperCase() + latin.slice(1);
  }).join('');
}

function titleKey(title: string): string {
  return title
    .toLocaleLowerCase('ru')
    .replace(/ё/gu, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Русское название роли → английское, только если вариант однозначен. */
function buildRuTitleIndex(): ReadonlyMap<string, string | null> {
  const index = new Map<string, string | null>();
  for (const role of ontology.roles) {
    for (const variant of [role.titleRu, ...role.variants.ru]) {
      const key = titleKey(variant);
      const known = index.get(key);
      index.set(key, known === undefined || known === role.titleEn ? role.titleEn : null);
    }
  }
  return index;
}

const RU_TITLE_INDEX = buildRuTitleIndex();

/** Должность для английского письма или `null`, если перевести честно нельзя. */
export function englishJobTitle(title: string): string | null {
  if (!hasCyrillic(title)) return title;
  return RU_TITLE_INDEX.get(titleKey(title)) ?? null;
}

/** Имя собственное (компания, кандидат) для английского письма. */
export function englishProperName(name: string): string {
  return hasCyrillic(name) ? latinize(name) : name;
}

const SLUG_PART = /^(?:\p{Lu}[\p{Ll}\d]*|\p{Lu}+)$/u;

/**
 * Ключ требования из кластера («Director-Of-Technology») → подпись для
 * человека («Director of technology»). Настоящие термины с дефисом (T-SQL,
 * CI-CD) не трогаем: в них нет ни одного слова со строчными буквами.
 */
export function requirementLabel(requirement: string): string {
  const parts = requirement.trim().split('-');
  const isSlug =
    parts.length >= 2 &&
    parts.every((part) => SLUG_PART.test(part)) &&
    parts.some((part) => /^\p{Lu}\p{Ll}{2,}/u.test(part));
  if (!isSlug) return requirement.trim();
  const words = parts.map((part) => (/^\p{Lu}+$/u.test(part) ? part : part.toLocaleLowerCase()));
  const label = words.join(' ');
  return label.charAt(0).toLocaleUpperCase() + label.slice(1);
}
