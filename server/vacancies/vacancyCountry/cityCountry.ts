/**
 * B803: страна города по GeoNames (cities5000, CC BY 4.0; атрибуция в NOTICE). Город, у которого есть
 * сопоставимый тёзка в другой стране, в словарь не входит.
 */
import { gunzipSync } from 'node:zlib';
import { CITY_COUNTRY_GZIP_BASE64 } from './cityCountryData';

interface City {
  readonly country: string;
  /** Город от 50 тыс.: одно слово внутри строки читается только у него. */
  readonly large: boolean;
}

let namesakes: ReadonlyMap<string, readonly string[]> | undefined;
let index: ReadonlyMap<string, City> | undefined;

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

function lines(): readonly string[] {
  return gunzipSync(Buffer.from(CITY_COUNTRY_GZIP_BASE64.join(''), 'base64'))
    .toString()
    .split('\n');
}

/** Страны, где есть город с таким именем, от крупнейшего; у однозначного — одна. */
export function cityCountries(city: string): readonly string[] {
  namesakes ??= new Map(
    lines().flatMap((line) => {
      if (!line.startsWith('~')) return [];
      const [key = '', ...names] = line.slice(1).split('|');
      return names.map((name) => [name, key.split(',')] as const);
    }),
  );
  const found = namesakes.get(city.normalize('NFC').trim().toLowerCase());
  if (found) return found;
  const only = cityCountry(city);
  return only ? [only] : [];
}

function cities(): ReadonlyMap<string, City> {
  if (!index) {
    index = new Map(
      lines().flatMap((line) => {
        const [key = '', ...names] = line.split('|');
        if (key.startsWith('~')) return [];
        const city = { country: key.slice(0, 2), large: key.endsWith('+') };
        return names.map((name) => [name, city] as const);
      }),
    );
  }
  return index;
}

function cityNamed(name: string): City | undefined {
  const key = name.normalize('NFC').trim().toLowerCase();
  return onlyCommonWords(key) ? undefined : cities().get(key);
}

export function cityCountry(city: string): string | undefined {
  return cityNamed(city)?.country;
}

const MAX_WORDS = 3;
const MIN_LENGTH = 5;

/** «West London», «Friedrichshafen Werk»: город внутри строки; два города разных стран — нет ответа. */
export function cityCountryInText(text: string): string | undefined {
  const words = text.split(/[\s,()/-]+/u).filter(Boolean);
  const found = new Set<string>();
  for (let size = Math.min(MAX_WORDS, words.length); size > 0 && found.size === 0; size -= 1) {
    for (let at = 0; at + size <= words.length; at += 1) {
      const name = words.slice(at, at + size).join(' ');
      const proper = /^\p{Lu}/u.test(name);
      const city = proper && name.length >= MIN_LENGTH ? cityNamed(name) : undefined;
      if (city && (size > 1 || city.large)) found.add(city.country);
    }
  }
  return found.size === 1 ? [...found][0] : undefined;
}
