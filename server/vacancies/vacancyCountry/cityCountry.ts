/**
 * B803: страна города по GeoNames (cities5000, CC BY 4.0; атрибуция в NOTICE). Город, у которого есть
 * сопоставимый тёзка в другой стране, в словарь не входит.
 */

/** Где искать: словарь в обслуживании или таблица базы в веб-процессе. Ключ — имя строчными. */
export interface CityDictionary {
  /** «US» или «US+» (город от 50 тыс.: одно слово внутри строки читается только у него). */
  code(name: string): string | undefined;
  /** Все страны имени-тёзки: «CA,US». */
  namesakes(name: string): string | undefined;
}

export interface Cities {
  country(city: string): string | undefined;
  /** Страны, где есть город с таким именем; у однозначного — одна. */
  countries(city: string): readonly string[];
  inText(text: string): string | undefined;
}

/** Регионы и обычные слова, которые где-то ещё и город. */
const NOT_CITIES: ReadonlySet<string> = new Set(
  (
    'america americas latin north south east west central northern southern eastern western asia ' +
    'pacific europe africa middle nordic nordics baltic balkan balkans caribbean atlantic emea apac ' +
    'latam world global worldwide international national time zone field sales center centre union ' +
    'macedonia victoria remote office plant site park hill hills valley island islands lake river bay ' +
    'beach port city town village county state states province territory market markets street road ' +
    'avenue tower building industrial airport station university college hospital school general ' +
    'business digital mobile media commerce enterprise progress liberty freedom independence ' +
    'triangle orange columbia cumberland granada santiago córdoba cordoba'
  ).split(' '),
);

function onlyCommonWords(name: string): boolean {
  return name.split(/[\s-]+/u).every((word) => NOT_CITIES.has(word));
}

const MAX_WORDS = 3;
const MIN_LENGTH = 5;
/** Место — короткая строка; длинное перечисление читаем только сначала. */
const MAX_TEXT_WORDS = 12;

const keyOf = (name: string): string => name.normalize('NFC').trim().toLowerCase();

function codeOf(dictionary: CityDictionary, name: string): string | undefined {
  const key = keyOf(name);
  return onlyCommonWords(key) ? undefined : dictionary.code(key);
}

/** «West London», «Friedrichshafen Werk»: город внутри строки; два города разных стран — нет ответа. */
function countryInText(dictionary: CityDictionary, text: string): string | undefined {
  const words = text
    .split(/[\s,()/-]+/u)
    .filter(Boolean)
    .slice(0, MAX_TEXT_WORDS);
  const found = new Set<string>();
  for (let size = Math.min(MAX_WORDS, words.length); size > 0 && found.size === 0; size -= 1) {
    for (let at = 0; at + size <= words.length; at += 1) {
      const name = words.slice(at, at + size).join(' ');
      const proper = /^\p{Lu}/u.test(name);
      const code = proper && name.length >= MIN_LENGTH ? codeOf(dictionary, name) : undefined;
      if (code && (size > 1 || code.endsWith('+'))) found.add(code.slice(0, 2));
    }
  }
  return found.size === 1 ? [...found][0] : undefined;
}

export function createCities(dictionary: CityDictionary): Cities {
  const country = (city: string) => codeOf(dictionary, city)?.slice(0, 2);
  return {
    country,
    countries(city) {
      const shared = dictionary.namesakes(keyOf(city));
      if (shared) return shared.split(',');
      const only = country(city);
      return only ? [only] : [];
    },
    inText: (text) => countryInText(dictionary, text),
  };
}
