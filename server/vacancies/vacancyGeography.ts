import type { CandidateRegion } from '../../src/features/workspace/candidateRegions';
import type { OrderableMatch } from '../../shared/vacancyMatchOrder';
import { compareMatchedVacancies } from '../../shared/vacancyMatchOrder';

/**
 * География вакансии по её локации и стране (PRB-040).
 *
 * Подбор для кампании «MENA» открывался записями из США и Никарагуа: регион
 * кампании нигде не читался. Вакансия не несёт кода региона — только строку
 * места и иногда страну, поэтому регион выводится из словаря стран и городов
 * тех же семи рынков, по которым платформа собирает вакансии
 * (`jobspyFan.ts`, `candidateRegions.ts`). Неизвестное место — `undefined`,
 * а не «вне географии»: молчание словаря не должно прятать вакансию.
 */

type PlaceRegion = CandidateRegion;

const COUNTRY_REGION: ReadonlyArray<readonly [string, PlaceRegion]> = [
  ['united states', 'us'], ['usa', 'us'], ['us', 'us'], ['сша', 'us'], ['canada', 'us'], ['канада', 'us'],
  ['united kingdom', 'eu'], ['uk', 'eu'], ['england', 'eu'], ['великобритания', 'eu'],
  ['germany', 'eu'], ['германия', 'eu'], ['deutschland', 'eu'], ['france', 'eu'], ['франция', 'eu'],
  ['netherlands', 'eu'], ['нидерланды', 'eu'], ['spain', 'eu'], ['испания', 'eu'], ['italy', 'eu'],
  ['италия', 'eu'], ['ireland', 'eu'], ['ирландия', 'eu'], ['poland', 'eu'], ['польша', 'eu'],
  ['portugal', 'eu'], ['португалия', 'eu'], ['sweden', 'eu'], ['швеция', 'eu'], ['switzerland', 'eu'],
  ['швейцария', 'eu'], ['austria', 'eu'], ['австрия', 'eu'], ['belgium', 'eu'], ['бельгия', 'eu'],
  ['czech republic', 'eu'], ['czechia', 'eu'], ['чехия', 'eu'], ['denmark', 'eu'], ['дания', 'eu'],
  ['finland', 'eu'], ['финляндия', 'eu'], ['norway', 'eu'], ['норвегия', 'eu'], ['romania', 'eu'],
  ['румыния', 'eu'], ['cyprus', 'eu'], ['кипр', 'eu'], ['serbia', 'eu'], ['сербия', 'eu'],
  ['greece', 'eu'], ['греция', 'eu'], ['hungary', 'eu'], ['венгрия', 'eu'], ['lithuania', 'eu'],
  ['latvia', 'eu'], ['estonia', 'eu'], ['bulgaria', 'eu'], ['croatia', 'eu'], ['montenegro', 'eu'],
  ['united arab emirates', 'mena'], ['uae', 'mena'], ['оаэ', 'mena'], ['saudi arabia', 'mena'],
  ['саудовская аравия', 'mena'], ['qatar', 'mena'], ['катар', 'mena'], ['kuwait', 'mena'],
  ['bahrain', 'mena'], ['oman', 'mena'], ['egypt', 'mena'], ['египет', 'mena'], ['morocco', 'mena'],
  ['israel', 'mena'], ['израиль', 'mena'], ['turkey', 'mena'], ['türkiye', 'mena'], ['турция', 'mena'],
  ['jordan', 'mena'], ['lebanon', 'mena'], ['tunisia', 'mena'], ['algeria', 'mena'],
  ['india', 'apac'], ['индия', 'apac'], ['singapore', 'apac'], ['сингапур', 'apac'], ['australia', 'apac'],
  ['австралия', 'apac'], ['japan', 'apac'], ['япония', 'apac'], ['hong kong', 'apac'], ['malaysia', 'apac'],
  ['philippines', 'apac'], ['indonesia', 'apac'], ['south korea', 'apac'], ['korea', 'apac'],
  ['new zealand', 'apac'], ['vietnam', 'apac'], ['thailand', 'apac'], ['china', 'apac'], ['китай', 'apac'],
  ['taiwan', 'apac'], ['pakistan', 'apac'], ['bangladesh', 'apac'],
  ['brazil', 'latam'], ['бразилия', 'latam'], ['mexico', 'latam'], ['мексика', 'latam'],
  ['argentina', 'latam'], ['аргентина', 'latam'], ['chile', 'latam'], ['colombia', 'latam'],
  ['peru', 'latam'], ['uruguay', 'latam'], ['costa rica', 'latam'], ['nicaragua', 'latam'],
  ['guatemala', 'latam'], ['panama', 'latam'], ['ecuador', 'latam'], ['venezuela', 'latam'],
  ['dominican republic', 'latam'], ['honduras', 'latam'], ['el salvador', 'latam'], ['bolivia', 'latam'],
  ['paraguay', 'latam'],
  ['russia', 'ru'], ['russian federation', 'ru'], ['россия', 'ru'], ['рф', 'ru'],
  ['ukraine', 'cis'], ['украина', 'cis'], ['kazakhstan', 'cis'], ['казахстан', 'cis'], ['georgia', 'cis'],
  ['грузия', 'cis'], ['armenia', 'cis'], ['армения', 'cis'], ['uzbekistan', 'cis'], ['узбекистан', 'cis'],
  ['azerbaijan', 'cis'], ['азербайджан', 'cis'], ['belarus', 'cis'], ['беларусь', 'cis'],
  ['kyrgyzstan', 'cis'], ['киргизия', 'cis'], ['moldova', 'cis'], ['молдова', 'cis'],
  ['tajikistan', 'cis'], ['таджикистан', 'cis'],
];

/** ISO-коды стран, которыми площадки называют рынок (Indeed, LinkedIn). */
const ISO_REGION: Readonly<Record<string, PlaceRegion>> = {
  US: 'us', CA: 'us',
  GB: 'eu', DE: 'eu', FR: 'eu', NL: 'eu', ES: 'eu', IT: 'eu', IE: 'eu', PL: 'eu', PT: 'eu', SE: 'eu',
  CH: 'eu', AT: 'eu', BE: 'eu', CZ: 'eu', DK: 'eu', FI: 'eu', NO: 'eu', RO: 'eu', CY: 'eu', RS: 'eu',
  AE: 'mena', SA: 'mena', QA: 'mena', KW: 'mena', BH: 'mena', OM: 'mena', EG: 'mena', MA: 'mena',
  IL: 'mena', TR: 'mena',
  IN: 'apac', SG: 'apac', AU: 'apac', JP: 'apac', HK: 'apac', MY: 'apac', PH: 'apac', ID: 'apac',
  KR: 'apac', NZ: 'apac', VN: 'apac', TH: 'apac', CN: 'apac',
  BR: 'latam', MX: 'latam', AR: 'latam', CL: 'latam', CO: 'latam', PE: 'latam', UY: 'latam',
  CR: 'latam', NI: 'latam',
  RU: 'ru',
  UA: 'cis', KZ: 'cis', GE: 'cis', AM: 'cis', UZ: 'cis', AZ: 'cis', BY: 'cis', KG: 'cis', MD: 'cis',
};

/** Города веера «роль × рынок» и крупные города hh.ru. */
const CITY_REGION: ReadonlyArray<readonly [string, PlaceRegion]> = [
  ['new york', 'us'], ['san francisco', 'us'], ['seattle', 'us'], ['austin', 'us'], ['boston', 'us'],
  ['chicago', 'us'], ['los angeles', 'us'], ['toronto', 'us'], ['vancouver', 'us'],
  ['london', 'eu'], ['manchester', 'eu'], ['berlin', 'eu'], ['munich', 'eu'], ['paris', 'eu'],
  ['amsterdam', 'eu'], ['madrid', 'eu'], ['barcelona', 'eu'], ['milan', 'eu'], ['dublin', 'eu'],
  ['warsaw', 'eu'], ['lisbon', 'eu'], ['stockholm', 'eu'], ['zurich', 'eu'], ['vienna', 'eu'],
  ['brussels', 'eu'], ['prague', 'eu'], ['copenhagen', 'eu'], ['helsinki', 'eu'], ['oslo', 'eu'],
  ['bucharest', 'eu'], ['limassol', 'eu'], ['belgrade', 'eu'], ['berlin', 'eu'], ['лондон', 'eu'],
  ['берлин', 'eu'], ['лимассол', 'eu'], ['белград', 'eu'],
  ['dubai', 'mena'], ['abu dhabi', 'mena'], ['riyadh', 'mena'], ['doha', 'mena'], ['kuwait city', 'mena'],
  ['manama', 'mena'], ['muscat', 'mena'], ['cairo', 'mena'], ['casablanca', 'mena'], ['tel aviv', 'mena'],
  ['istanbul', 'mena'], ['дубай', 'mena'], ['стамбул', 'mena'], ['тель-авив', 'mena'],
  ['bangalore', 'apac'], ['bengaluru', 'apac'], ['mumbai', 'apac'], ['hyderabad', 'apac'], ['sydney', 'apac'],
  ['melbourne', 'apac'], ['tokyo', 'apac'], ['kuala lumpur', 'apac'], ['manila', 'apac'], ['jakarta', 'apac'],
  ['seoul', 'apac'], ['auckland', 'apac'], ['ho chi minh city', 'apac'], ['bangkok', 'apac'],
  ['sao paulo', 'latam'], ['são paulo', 'latam'], ['mexico city', 'latam'], ['buenos aires', 'latam'],
  ['santiago', 'latam'], ['bogota', 'latam'], ['bogotá', 'latam'], ['lima', 'latam'], ['montevideo', 'latam'],
  ['москва', 'ru'], ['moscow', 'ru'], ['санкт-петербург', 'ru'], ['saint petersburg', 'ru'],
  ['st. petersburg', 'ru'], ['новосибирск', 'ru'], ['екатеринбург', 'ru'], ['казань', 'ru'],
  ['нижний новгород', 'ru'], ['краснодар', 'ru'], ['самара', 'ru'], ['ростов-на-дону', 'ru'],
  ['kyiv', 'cis'], ['kiev', 'cis'], ['киев', 'cis'], ['алматы', 'cis'], ['almaty', 'cis'], ['астана', 'cis'],
  ['astana', 'cis'], ['тбилиси', 'cis'], ['tbilisi', 'cis'], ['ереван', 'cis'], ['yerevan', 'cis'],
  ['ташкент', 'cis'], ['tashkent', 'cis'], ['минск', 'cis'], ['minsk', 'cis'], ['баку', 'cis'], ['baku', 'cis'],
];

function normalisePlace(value: string): string {
  return value.toLowerCase().replace(/[.,;()]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function regionOfCountryName(name: string): PlaceRegion | undefined {
  const clean = normalisePlace(name);
  if (!clean) return undefined;
  const iso = ISO_REGION[name.trim().toUpperCase()];
  if (iso && name.trim().length === 2) return iso;
  return COUNTRY_REGION.find(([country]) => country === clean)?.[1];
}

export interface VacancyPlace {
  readonly location?: string;
  readonly country?: string;
}

export function regionOfVacancy(place: VacancyPlace): PlaceRegion | undefined {
  if (place.country) {
    const byCountry = regionOfCountryName(place.country);
    if (byCountry) return byCountry;
  }
  const location = place.location?.trim();
  if (!location) return undefined;
  // Страна обычно стоит последней: «Düsseldorf, North Rhine-Westphalia, Germany».
  const parts = location.split(/[,·|/]/u).map((part) => part.trim()).filter(Boolean);
  for (const part of [...parts].reverse()) {
    const byCountry = regionOfCountryName(part);
    if (byCountry) return byCountry;
  }
  const haystack = ` ${normalisePlace(location)} `;
  for (const [city, region] of CITY_REGION) {
    if (haystack.includes(` ${city} `)) return region;
  }
  return undefined;
}

export interface GeographyMatch extends OrderableMatch {
  readonly cluster: OrderableMatch['cluster'] & {
    readonly canonicalLocation?: string;
    readonly isRemote?: boolean;
    readonly companyFeatures?: { readonly country?: string };
  };
  readonly explanation: OrderableMatch['explanation'] & { readonly outsideGeography?: boolean };
}

/**
 * Помечает записи вне рынков кампании и ставит их после остальных. Удалёнка и
 * место, которого словарь не знает, «вне географии» не считаются.
 */
export function markGeography<T extends GeographyMatch>(
  matched: readonly T[],
  regions: readonly CandidateRegion[],
): T[] {
  if (regions.length === 0) return [...matched];
  const wanted = new Set<PlaceRegion>(regions);
  const marked = matched.map((item) => {
    if (item.cluster.isRemote) return item;
    const region = regionOfVacancy({
      location: item.cluster.canonicalLocation,
      country: item.cluster.companyFeatures?.country,
    });
    if (!region || wanted.has(region)) return item;
    return { ...item, explanation: { ...item.explanation, outsideGeography: true } };
  });
  return marked.sort(
    (left, right) =>
      Number(left.explanation.outsideGeography ?? false) -
        Number(right.explanation.outsideGeography ?? false) || compareMatchedVacancies(left, right),
  );
}
