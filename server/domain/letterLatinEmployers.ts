/**
 * B640, 10.11 (решение CPO): в английском письме название работодателя не пишется кириллицей
 * («Россети Цифра» в письмах CoinsPaid и LIYAN). Латиница берётся из уточнений и фактов кандидата,
 * если там она есть («Rosseti Tsifra»), иначе — транслитерация.
 */
const CYRILLIC = /\p{Script=Cyrillic}/u;
const LATIN_PHRASE = /\b[A-Z][\p{L}\d&.'-]*(?:\s+[A-Z][\p{L}\d&.'-]*)*/gu;
const MIN_PREFIX = 4;

const LETTERS: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Транслитерация по-английски: «Россети Цифра» → «Rosseti Tsifra». */
export function transliterate(text: string): string {
  return [...text]
    .map((char) => {
      const lower = char.toLocaleLowerCase('ru-RU');
      const latin = LETTERS[lower];
      if (latin === undefined) return char;
      return char === lower ? latin : latin.charAt(0).toUpperCase() + latin.slice(1);
    })
    .join('');
}

const words = (text: string) => text.split(/\s+/u).filter(Boolean);

/** Латинское написание из текстов кандидата: столько же слов, и первое слово совпадает началом. */
function latinFromTexts(name: string, texts: readonly string[]): string | undefined {
  const expected = words(transliterate(name).toLowerCase());
  const prefix = expected[0]?.slice(0, MIN_PREFIX);
  if (!prefix || prefix.length < MIN_PREFIX) return undefined;
  for (const text of texts) {
    for (const match of text.match(LATIN_PHRASE) ?? []) {
      const phrase = match.replace(/[.'-]+$/u, '');
      const found = words(phrase);
      if (found.length === expected.length && found[0]!.toLowerCase().startsWith(prefix)) return phrase;
    }
  }
  return undefined;
}

/** Замены «кириллическое название → латиница» для английского письма; длинные названия первыми. */
export function latinEmployerNames(
  employers: readonly string[],
  candidateTexts: readonly string[],
): ReadonlyMap<string, string> {
  const cyrillic = [...new Set(employers.map((name) => name.trim()))].filter((name) => CYRILLIC.test(name));
  return new Map(
    cyrillic
      .sort((left, right) => right.length - left.length)
      .map((name) => [name, latinFromTexts(name, candidateTexts) ?? transliterate(name)] as const),
  );
}

export function withLatinEmployerNames(text: string, names: ReadonlyMap<string, string>): string {
  return [...names].reduce((result, [name, latin]) => result.split(name).join(latin), text);
}
