import { ontology } from '../../shared/roleOntology';

/**
 * Письмо пишется на одном языке (G3 L1, 03.11). Шаблон не зовёт модель,
 * поэтому перевод детерминированный и честный (G3b, 03.11):
 * - должность — по каноническому названию роли или по словарю «глава + область»
 *   («Директор по разработке» → «Director of Engineering»). Варианты ролей не
 *   годятся: они сводят разные уровни к одной роли и делали директора «Head of
 *   Engineering». Должность без честного перевода опускается;
 * - компания — как её написал кандидат: латиница остаётся, кириллица остаётся в
 *   своём написании в кавычках. Транслит («Fintekh Lab») рекрутер читает как
 *   ошибку, а английского названия компании в профиле нет;
 * - имя кандидата — транслитерацией, как в загранпаспорте.
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

/** Канонические русские названия ролей (без «(CTO)») → английские, только однозначные. */
function buildCanonicalTitleIndex(): ReadonlyMap<string, string | null> {
  const index = new Map<string, string | null>();
  for (const role of ontology.roles) {
    const key = titleKey(role.titleRu.replace(/\([^)]*\)/gu, ''));
    const known = index.get(key);
    index.set(key, known === undefined || known === role.titleEn ? role.titleEn : null);
  }
  return index;
}

const CANONICAL_TITLES = buildCanonicalTitleIndex();

const TITLE_HEADS: readonly (readonly [string, string])[] = [
  ['заместитель генерального директора', 'Deputy CEO'],
  ['заместитель директора', 'Deputy Director'],
  ['заместитель руководителя', 'Deputy Head'],
  ['вице президент', 'Vice President'],
  ['директор', 'Director'],
  ['руководитель', 'Head'],
  ['начальник', 'Head'],
];

/** Подразделение между главой и областью («отдела разработки») не меняет перевод. */
const TITLE_UNIT = /^(?:отдела|группы|направления|департамента|управления|службы|центра)\s+/u;

/** Область в дательном («по разработке») и родительном («разработки») падеже. */
const TITLE_AREAS: Readonly<Record<string, string>> = {
  разработке: 'Engineering',
  разработки: 'Engineering',
  ит: 'IT',
  it: 'IT',
  технологиям: 'Technology',
  технологий: 'Technology',
  'информационной безопасности': 'Information Security',
  инфраструктуре: 'Infrastructure',
  инфраструктуры: 'Infrastructure',
  эксплуатации: 'Operations',
  операциям: 'Operations',
  операций: 'Operations',
  продукту: 'Product',
  продукта: 'Product',
  данным: 'Data',
  данных: 'Data',
  аналитике: 'Analytics',
  аналитики: 'Analytics',
  архитектуре: 'Architecture',
  архитектуры: 'Architecture',
  тестированию: 'QA',
  тестирования: 'QA',
  качеству: 'Quality',
  качества: 'Quality',
  дизайну: 'Design',
  дизайна: 'Design',
  маркетингу: 'Marketing',
  маркетинга: 'Marketing',
  продажам: 'Sales',
  продаж: 'Sales',
  персоналу: 'HR',
  персонала: 'HR',
  финансам: 'Finance',
  финансов: 'Finance',
};

/** «Директор по разработке» → «Director of Engineering»; `null`, если словаря не хватает. */
function composedTitle(key: string): string | null {
  for (const [head, english] of TITLE_HEADS) {
    if (!key.startsWith(`${head} `)) continue;
    const area = key.slice(head.length + 1).replace(/^по\s+/u, '').replace(TITLE_UNIT, '');
    const englishArea = TITLE_AREAS[area];
    return englishArea ? `${english} of ${englishArea}` : null;
  }
  return null;
}

/** Должность для английского письма или `null`, если перевести честно нельзя. */
export function englishJobTitle(title: string): string | null {
  if (!hasCyrillic(title)) return title;
  const key = titleKey(title);
  return CANONICAL_TITLES.get(key) ?? composedTitle(key);
}

/** Компания в английском письме: как написал кандидат, кириллица — в кавычках. */
export function letterEmployerName(name: string): string {
  if (!hasCyrillic(name)) return name;
  return `"${name.replace(/^["«„“\s]+|["»“”\s]+$/gu, '')}"`;
}

/** Имя кандидата для английского письма. */
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
