/**
 * B803: страна места вакансии для оценки рынка. Часть света не годится: оценки APAC считались
 * по филиппинским песо, а MENA — по удалёнке из США. Перечисление стран и «Remote» без страны — не страна.
 */
import { northAmericanCountryOf } from '../../../shared/postalPlace';
import { countryCodeFromNameOrCode, countryCodeOf } from '../../domain/geoCoordinates';
import { regionOfVacancy } from '../vacancyGeography';

const US_STATE_NAMES: ReadonlySet<string> = new Set(
  (
    'alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|' +
    'illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|' +
    'mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|' +
    'north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|' +
    'south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming'
  ).split('|'),
);
const CANADIAN_PROVINCE_NAMES: ReadonlySet<string> = new Set(
  'ontario|quebec|québec|british columbia|alberta|manitoba|saskatchewan|nova scotia'.split('|'),
);
/** Города-тёзки: без уточнения площадки пишут так крупнейший из них. */
const PLAIN_CITIES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    GB: 'london|лондон|manchester',
    US:
      'palo alto|mountain view|cupertino|san francisco|san francisco bay area|los angeles|new york city|' +
      'san jose|san diego|sunnyvale|menlo park|boston|chicago|seattle|austin|denver|atlanta|dallas|houston',
    AU: 'sydney|melbourne',
    ES: 'madrid|barcelona',
    IN: 'mumbai|hyderabad',
    BY: 'брест',
  }).flatMap(([code, cities]) => cities.split('|').map((city) => [city, code] as const)),
);
const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'united states of america': 'US',
  deutschland: 'DE',
  nederland: 'NL',
};
const WORK_MODE = /\b(?:remote|hybrid|on-?site)\b|удал[её]нно|гибрид/giu;
const WORKDAY_CODE = /^([A-Z]{2})[-_]\S/u;
const NOT_LISTED_PLACE = /^\d+\s+locations?$/iu;

function partsOf(location: string): string[] {
  return location
    .replace(WORK_MODE, ' ')
    .split(/[,()]+|\s+[-–—]\s+/u)
    .map((part) => part.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
}

/** «Chicago, IL» — Иллинойс, а «Berlin, DE» — Германия: решает город. */
function postalCountry(part: string, city: string): string | undefined {
  const byState = northAmericanCountryOf(part);
  if (byState) {
    const iso = countryCodeFromNameOrCode(part);
    if (iso && countryCodeOf(city) === iso) return iso;
    return byState === 'Canada' ? 'CA' : 'US';
  }
  const name = part.toLowerCase();
  if (US_STATE_NAMES.has(name)) return 'US';
  return CANADIAN_PROVINCE_NAMES.has(name) ? 'CA' : undefined;
}

function countryName(part: string): string | undefined {
  return COUNTRY_ALIASES[part.toLowerCase()] ?? countryCodeFromNameOrCode(part);
}

function tailCountries(parts: readonly string[]): ReadonlySet<string> {
  const [city = '', ...tail] = parts;
  const codes = new Set<string>();
  for (const part of tail) {
    if (part.toLowerCase() === 'georgia') {
      const byCity = countryCodeOf(city);
      if (byCity === 'GE' || byCity === 'US') codes.add(byCity);
      continue;
    }
    const code = postalCountry(part, city) ?? countryName(part);
    if (code) codes.add(code);
  }
  return codes;
}

/** «Фокино (Брянская область)», «Севастополь»: словарь мест платформы относит их к российскому рынку. */
function russianPlace(text: string): boolean {
  return !/[іїєґ]/iu.test(text) && regionOfVacancy({ location: text }) === 'ru';
}

function cityCountry(city: string, text: string): string | undefined {
  const plain = PLAIN_CITIES.get(city.replace(/\s+(?:office|hq|campus)$/iu, '').toLowerCase());
  if (plain) return plain;
  const code = countryCodeOf(city);
  const russian = russianPlace(text);
  if (russian && (!code || code === 'UA' || text.includes('('))) return 'RU';
  return code;
}

function countryOfPlace(text: string): string | undefined {
  const workday = WORKDAY_CODE.exec(text)?.[1];
  const workdayCode = workday ? countryCodeFromNameOrCode(workday) : undefined;
  if (workdayCode) return workdayCode;
  const parts = partsOf(text);
  const first = parts[0];
  const last = parts.at(-1);
  if (!first || !last) return undefined;
  if (parts.length === 1) return countryName(first) ?? cityCountry(first, text);
  // «Leipzig, SN, Germany»: полное название страны в конце важнее кодов земель.
  const named = last.length > 2 && !postalCountry(last, first) ? countryName(last) : undefined;
  if (named && last.toLowerCase() !== 'georgia') return named;
  const codes = tailCountries(parts);
  // «Toronto, ON, CA»: CA — код страны, раз провинция уже названа.
  if (codes.has('CA') && last === 'CA') return 'CA';
  if (codes.size > 0) return codes.size === 1 ? [...codes][0] : undefined;
  return countryName(first) ?? cityCountry(first, text);
}

/** ISO-код одной страны; две разные страны или ни одной — `undefined`. */
export function marketSalaryCountry(location: string | null | undefined): string | undefined {
  const text = location?.trim();
  if (!text || NOT_LISTED_PLACE.test(text)) return undefined;
  const codes = new Set(
    text
      .split(/[;|/·]+/u)
      .map((place) => countryOfPlace(place.trim()))
      .filter((code) => code !== undefined),
  );
  return codes.size === 1 ? [...codes][0] : undefined;
}

/** Место города в ключе: «Cambridge» в США и в Британии — разные группы. */
export function marketSalaryCityPlace(country: string, city: string): string {
  return `${country}:${city}`;
}
