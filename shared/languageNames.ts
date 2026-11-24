/**
 * Словарь языков: источники (LinkedIn, hh) пишут язык по-английски («english»), кандидат
 * видит его по-русски. Нет в словаре — название как есть.
 */
const LANGUAGE_NAMES_RU: Readonly<Record<string, string>> = {
  english: 'Английский',
  russian: 'Русский',
  german: 'Немецкий',
  french: 'Французский',
  spanish: 'Испанский',
  italian: 'Итальянский',
  portuguese: 'Португальский',
  serbian: 'Сербский',
  greek: 'Греческий',
  turkish: 'Турецкий',
  arabic: 'Арабский',
  georgian: 'Грузинский',
  armenian: 'Армянский',
  kazakh: 'Казахский',
  chinese: 'Китайский',
  japanese: 'Японский',
  dutch: 'Нидерландский',
  polish: 'Польский',
  hebrew: 'Иврит',
  ukrainian: 'Украинский',
  romanian: 'Румынский',
};

export function languageNameRu(name: string): string {
  const trimmed = name.trim();
  return LANGUAGE_NAMES_RU[trimmed.toLocaleLowerCase('en')] ?? trimmed;
}

const LANGUAGE_FORMS: readonly (readonly [key: string, ruStem: string, ruName: string])[] =
  Object.entries(LANGUAGE_NAMES_RU).map(([key, name]) => {
    const ruName = name.toLocaleLowerCase('ru');
    return [key, ruName.replace(/ий$/u, ''), ruName];
  });

/** Ключ языка по слову на любом из двух языков: «English», «английский», «английского». */
export function languageKey(word: string): string | null {
  const token = word.trim().toLocaleLowerCase('ru');
  const found = LANGUAGE_FORMS.find(
    ([key, stem, name]) =>
      token === key ||
      token === name ||
      (stem !== name &&
        /^(?:ий|ого|ому|им|ом)$/u.test(token.slice(stem.length)) &&
        token.startsWith(stem)),
  );
  return found?.[0] ?? null;
}
