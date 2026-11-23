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
