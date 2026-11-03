import { geoCity } from '../../shared/geo/geoDirectory';
import '../../shared/geo/serverGeoDirectory';
import { northAmericanCountryOf } from '../../shared/postalPlace';
import { areasIn, ISO_BY_RUSSIAN_LABEL, KNOWN_ISO } from './placeNames';

const REMOTE_WORD =
  /\b(?:fully\s+)?remote(?:ly)?\b|\banywhere\b|удал[её]нн?\p{L}*|дистанц\p{L}*|\bhybrid\b/giu;
const PART_SEPARATOR = /[;,|/·:]|\s[-–—]\s|^\s*[-–—]|[-–—]\s*$/u;

function cleanPart(part: string): string {
  return part
    .replace(/\([^)]*\)|\b(?:office|hq|headquarters)\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function partAreas(part: string): string[] {
  const named = areasIn(` ${part} `);
  if (named.length > 0) return named;
  const clean = cleanPart(part);
  if (!clean) return [];
  const northAmerican = northAmericanCountryOf(clean);
  if (northAmerican) return [northAmerican === 'Canada' ? 'CA' : 'US'];
  if (/^[A-Z]{2}$/u.test(clean) && KNOWN_ISO.has(clean)) return [clean];
  const city = geoCity(clean);
  const iso = city ? ISO_BY_RUSSIAN_LABEL.get(city.country) : undefined;
  return iso ? [iso] : [];
}

function locationParts(location: string): string[] {
  return location.replace(REMOTE_WORD, ' ').split(PART_SEPARATOR);
}

/** Страны и блоки стран, которые называет строка места. */
export function locationAreas(location: string): string[] {
  // Workday пишет код страны первым: «US-CA-Menlo Park».
  const workday = /^([A-Z]{2})-\S/u.exec(location)?.[1];
  if (workday && KNOWN_ISO.has(workday)) return [workday];
  return locationParts(location).flatMap(partAreas);
}
