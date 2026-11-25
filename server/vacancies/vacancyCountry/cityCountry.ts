/**
 * B803: страна города по GeoNames (cities5000, CC BY 4.0; атрибуция в NOTICE). Город, у которого есть
 * сопоставимый тёзка в другой стране, в словарь не входит.
 */
import { gunzipSync } from 'node:zlib';
import { CITY_COUNTRY_GZIP_BASE64 } from './cityCountryData';

let index: ReadonlyMap<string, string> | undefined;

function cities(): ReadonlyMap<string, string> {
  if (!index) {
    const text = gunzipSync(Buffer.from(CITY_COUNTRY_GZIP_BASE64.join(''), 'base64')).toString();
    index = new Map(
      text.split('\n').flatMap((line) => {
        const [country = '', ...names] = line.split('|');
        return names.map((name) => [name, country] as const);
      }),
    );
  }
  return index;
}

export function cityCountry(city: string): string | undefined {
  return cities().get(city.normalize('NFC').trim().toLowerCase());
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
      const country = proper && name.length >= MIN_LENGTH ? cityCountry(name) : undefined;
      if (country) found.add(country);
    }
  }
  return found.size === 1 ? [...found][0] : undefined;
}
