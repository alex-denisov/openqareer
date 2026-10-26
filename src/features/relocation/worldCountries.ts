import { countryNameRu } from '../../../shared/geo/countryNames';

/**
 * Every country by ISO 3166-1 alpha-2, named in Russian by the platform.
 * Citizenship and the country of a diploma are not limited to the rules
 * catalog: a Moldovan diploma has to be pickable even with no Moldovan rules.
 */
const ISO_CODES = (
  'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL ' +
  'NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM ' +
  'TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW'
).split(' ');

export interface WorldCountry {
  readonly countryCode: string;
  readonly name: string;
}

let cache: readonly WorldCountry[] | undefined;

export function listWorldCountries(): readonly WorldCountry[] {
  cache ??= ISO_CODES.map((countryCode) => ({
    countryCode,
    name: countryNameRu(countryCode),
  })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return cache;
}

export function worldCountryName(code: string): string | undefined {
  return listWorldCountries().find(({ countryCode }) => countryCode === code)?.name;
}

/** «Молдова», «Moldova», «MD» → `MD`; free text that names no country → undefined. */
export function worldCountryCode(text: string): string | undefined {
  const needle = text.trim();
  if (!needle) return undefined;
  const upper = needle.toUpperCase();
  if (ISO_CODES.includes(upper)) return upper;
  const lower = needle.toLocaleLowerCase('ru');
  const ru = listWorldCountries().find(({ name }) => name.toLocaleLowerCase('ru') === lower);
  if (ru) return ru.countryCode;
  try {
    const en = new Intl.DisplayNames(['en'], { type: 'region' });
    return ISO_CODES.find((code) => en.of(code)?.toLowerCase() === needle.toLowerCase());
  } catch {
    return undefined;
  }
}
