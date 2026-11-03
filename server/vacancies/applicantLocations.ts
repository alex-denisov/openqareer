/**
 * Countries a remote applicant may live in, for Google's
 * `applicantLocationRequirements` (03.11).
 *
 * Google requires at least one Country on a TELECOMMUTE posting and documents
 * no pattern for "worldwide", so «Worldwide», «Anywhere» and a bare «Remote»
 * resolve to nothing here and the caller leaves the posting unmarked.
 */
import { countryCodeFromNameOrCode, countryCodeOf } from '../domain/geoCoordinates';

const LATAM = [
  'AR',
  'BO',
  'BR',
  'CL',
  'CO',
  'CR',
  'DO',
  'EC',
  'GT',
  'HN',
  'MX',
  'NI',
  'PA',
  'PE',
  'PR',
  'PY',
  'SV',
  'UY',
  'VE',
];
const EU = [
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
];
const EUROPE = [...EU, 'AL', 'BA', 'CH', 'GB', 'IS', 'LI', 'MD', 'ME', 'MK', 'NO', 'RS', 'UA'];
const MIDDLE_EAST = ['AE', 'BH', 'IL', 'JO', 'KW', 'LB', 'OM', 'QA', 'SA', 'TR'];
const AFRICA = ['EG', 'GH', 'KE', 'MA', 'NG', 'RW', 'SN', 'TN', 'UG', 'ZA'];
const ASIA = [
  'BD',
  'CN',
  'HK',
  'ID',
  'IN',
  'JP',
  'KR',
  'LK',
  'MY',
  'PH',
  'PK',
  'SG',
  'TH',
  'TW',
  'VN',
];
const NORTH_AMERICA = ['US', 'CA'];

/** Region labels sources write, as normalized keys. */
const MACRO_REGIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ['latam', LATAM],
  ['latinamerica', LATAM],
  ['southamerica', LATAM],
  ['eu', EU],
  ['europe', EUROPE],
  ['европа', EUROPE],
  ['emea', [...EUROPE, ...MIDDLE_EAST, ...AFRICA]],
  ['middleeast', MIDDLE_EAST],
  ['mena', [...MIDDLE_EAST, 'EG', 'MA', 'TN']],
  ['africa', AFRICA],
  ['apac', [...ASIA, 'AU', 'NZ']],
  ['asia', ASIA],
  ['northamerica', NORTH_AMERICA],
  ['amer', [...NORTH_AMERICA, ...LATAM]],
  ['americas', [...NORTH_AMERICA, ...LATAM]],
]);

/** Whole-word region names a title may carry («Engineer LATAM», «(EMEA)»). */
const TITLE_REGION =
  /(?<![\p{L}\p{N}])(latam|latin america|emea|apac|mena|europe|americas)(?![\p{L}\p{N}])/iu;

function regionKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function unique(codes: readonly string[]): string[] {
  return [...new Set(codes)];
}

function fromLocation(location: string): string[] {
  const parts = location
    .split(/[,|()/;]+|\s[-–—]\s/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const countries = parts.flatMap((part) => countryCodeFromNameOrCode(part) ?? []);
  if (countries.length > 0) return unique(countries);
  const regions = parts.flatMap((part) => MACRO_REGIONS.get(regionKey(part)) ?? []);
  if (regions.length > 0) return unique(regions);
  const city = countryCodeOf(location);
  return city ? [city] : [];
}

/**
 * ISO 3166-1 alpha-2 codes, in the order the source named them: concrete
 * countries first, else macro-regions, else a city's country, else a region
 * named in the title. Empty when nothing is stated.
 */
export function applicantCountries(location?: string, title?: string): string[] {
  const stated = location ? fromLocation(location) : [];
  if (stated.length > 0) return stated;
  const region = title?.match(TITLE_REGION)?.[1];
  return region ? [...(MACRO_REGIONS.get(regionKey(region)) ?? [])] : [];
}
