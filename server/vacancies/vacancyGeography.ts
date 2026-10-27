import type { CandidateRegion } from '../../src/features/workspace/candidateRegions';
import type { OrderableMatch } from '../../shared/vacancyMatchOrder';
import { compareMatchedVacancies } from '../../shared/vacancyMatchOrder';
import { northAmericanCountryOf } from '../../shared/postalPlace';

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
  ['united states', 'us'], ['united states of america', 'us'], ['usa', 'us'], ['us', 'us'], ['сша', 'us'], ['canada', 'us'], ['канада', 'us'],
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
  // 27.10: страны, которые Himalayas и Indeed пишут без города, — иначе «страна не указана».
  ['jamaica', 'latam'], ['bahamas', 'latam'], ['the bahamas', 'latam'], ['suriname', 'latam'],
  ['guyana', 'latam'], ['belize', 'latam'], ['haiti', 'latam'], ['cuba', 'latam'],
  ['trinidad and tobago', 'latam'], ['barbados', 'latam'], ['puerto rico', 'latam'],
  ['cayman islands', 'latam'], ['bermuda', 'latam'],
  ['slovakia', 'eu'], ['slovenia', 'eu'], ['luxembourg', 'eu'], ['malta', 'eu'], ['iceland', 'eu'],
  ['albania', 'eu'], ['bosnia and herzegovina', 'eu'], ['north macedonia', 'eu'], ['kosovo', 'eu'],
  ['iraq', 'mena'], ['iran', 'mena'], ['libya', 'mena'], ['syria', 'mena'], ['yemen', 'mena'],
  ['palestine', 'mena'],
  ['sri lanka', 'apac'], ['nepal', 'apac'], ['cambodia', 'apac'], ['myanmar', 'apac'],
  ['mongolia', 'apac'], ['laos', 'apac'], ['afghanistan', 'apac'],
];

/**
 * Страны вне семи рынков платформы: регион у них не выводится, но удалёнка
 * оттуда — «другая страна», а не «страна не указана» (27.10, Нигерия).
 */
const COUNTRIES_OUTSIDE_MARKETS: ReadonlySet<string> = new Set([
  'nigeria', 'kenya', 'south africa', 'ghana', 'ethiopia', 'uganda', 'tanzania', 'rwanda',
  'senegal', 'cameroon', "cote d'ivoire", "côte d'ivoire", 'ivory coast', 'zambia', 'zimbabwe',
  'botswana', 'namibia', 'mauritius', 'angola', 'mozambique', 'madagascar', 'malawi', 'benin',
  'togo', 'mali', 'sudan',
]);

function namesCountryOutsideMarkets(location: string | undefined): boolean {
  return (location ?? '')
    .split(/[,·|/;]/u)
    .some((part) => COUNTRIES_OUTSIDE_MARKETS.has(normalisePlace(part)));
}

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
  // 28.10: города пула прода без страны (топ мест, которые словарь не узнавал).
  ['palo alto', 'us'], ['cupertino', 'us'], ['mountain view', 'us'], ['menlo park', 'us'],
  ['sunnyvale', 'us'], ['san jose', 'us'], ['san diego', 'us'], ['redmond', 'us'],
  ['bellevue', 'us'], ['santa clara', 'us'], ['denver', 'us'], ['atlanta', 'us'], ['dallas', 'us'],
  ['houston', 'us'], ['miami', 'us'], ['washington', 'us'], ['philadelphia', 'us'],
  ['montreal', 'us'], ['ottawa', 'us'], ['calgary', 'us'],
  ['бишкек', 'cis'], ['ош', 'cis'], ['караганда', 'cis'], ['шымкент', 'cis'], ['атырау', 'cis'],
  ['усть-каменогорск', 'cis'], ['костанай', 'cis'], ['павлодар', 'cis'], ['актобе', 'cis'],
  ['актау', 'cis'], ['кокшетау', 'cis'], ['уральск', 'cis'], ['тараз', 'cis'], ['кызылорда', 'cis'],
  ['экибастуз', 'cis'], ['темиртау', 'cis'], ['талдыкорган', 'cis'],
  ['брест', 'cis'], ['гомель', 'cis'], ['гродно', 'cis'], ['могилев', 'cis'], ['витебск', 'cis'],
  ['барановичи', 'cis'], ['борисов', 'cis'], ['молодечно', 'cis'], ['пинск', 'cis'],
  ['солигорск', 'cis'], ['бобруйск', 'cis'],
  ['самарканд', 'cis'], ['фергана', 'cis'], ['андижан', 'cis'], ['бухара', 'cis'],
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
  if (place.country && !northAmericanCountryOf(place.country)) {
    const byCountry = regionOfCountryName(place.country);
    if (byCountry) return byCountry;
  }
  const location = place.location?.trim();
  if (!location) return undefined;
  // Страна обычно стоит последней: «Düsseldorf, North Rhine-Westphalia, Germany».
  const parts = location.split(/[,·|/;]|\s[-–—]\s/u).map((part) => part.trim()).filter(Boolean);
  // «Chicago, IL»: после города код штата, а не ISO-код Израиля (B546).
  if (parts.length > 1 && northAmericanCountryOf(parts.at(-1) ?? '')) return 'us';
  for (const part of [...parts].reverse()) {
    const byCountry = regionOfCountryName(part);
    if (byCountry) return byCountry;
  }
  const haystack = ` ${normalisePlace(location)} `;
  // «Sunnyvale, California USA»: страна последним словом части (28.10).
  for (const part of [...parts].reverse()) {
    const word = part.split(/\s+/u).at(-1) ?? '';
    // «Remote in» — не Индия: двухбуквенный код только заглавными.
    if (word.length <= 2 && word !== word.toUpperCase()) continue;
    const byLastWord = regionOfCountryName(word);
    if (byLastWord) return byLastWord;
  }
  for (const [city, region] of CITY_REGION) {
    if (haystack.includes(` ${city} `)) return region;
  }
  return russianCityOf(location);
}

/** Не город: формат работы или пустая отметка площадки. */
const NOT_A_CITY = /удал|дистанц|любой|не указ|гибрид|офис/iu;
/** Города, страну которых платформа не называет. */
const CONTESTED_CITIES: ReadonlySet<string> = new Set(['донецк', 'луганск', 'мариуполь']);

/**
 * hh.ru пишет город кириллицей без страны: «Красноярск», «Подольск (Московская
 * область)». Города СНГ стоят в словаре явно, остальной кириллический город —
 * Россия (28.10, топ мест пула прода).
 */
function russianCityOf(location: string): PlaceRegion | undefined {
  if (!/^[\p{Script=Cyrillic}\s().\-–]+$/u.test(location) || NOT_A_CITY.test(location)) return undefined;
  const city = normalisePlace(location.replace(/\(.*\)/u, ''));
  return city && !CONTESTED_CITIES.has(city) ? 'ru' : undefined;
}

export interface GeographyMatch extends OrderableMatch {
  readonly cluster: OrderableMatch['cluster'] & {
    readonly canonicalLocation?: string;
    readonly isRemote?: boolean;
    readonly companyFeatures?: { readonly country?: string };
  };
  readonly explanation: OrderableMatch['explanation'] & {
    readonly outsideGeography?: boolean;
    readonly remoteCountry?: RemoteCountryFit;
  };
}

/** Удалёнка, которая не подтверждает рынок кандидата: страна не названа или другая. */
export type RemoteCountryFit = 'unknown' | 'other';

/**
 * CPO 26.10: «Remote» без страны или «Remote, United States» для кандидата
 * «Удалённо из РФ» — не совпадение. Запись не скрывается, а подписывается.
 */
export function remoteCountryFit(
  cluster: {
    readonly canonicalLocation?: string;
    readonly isRemote?: boolean;
    readonly companyFeatures?: { readonly country?: string };
  },
  regions: readonly CandidateRegion[],
): RemoteCountryFit | undefined {
  if (regions.length === 0 || !cluster.isRemote) return undefined;
  const region = regionOfVacancy({
    location: cluster.canonicalLocation,
    country: cluster.companyFeatures?.country,
  });
  if (!region) return namesCountryOutsideMarkets(cluster.canonicalLocation) ? 'other' : 'unknown';
  return new Set<PlaceRegion>(regions).has(region as PlaceRegion) ? undefined : 'other';
}

/**
 * Одна вакансия вне выбранных рынков: удалёнка и неизвестное место — не «вне».
 * Общее правило подборки и вкладки «Сохранённые» (B550).
 */
export function isOutsideGeography(
  cluster: {
    readonly canonicalLocation?: string;
    readonly isRemote?: boolean;
    readonly companyFeatures?: { readonly country?: string };
  },
  regions: readonly CandidateRegion[],
): boolean {
  if (regions.length === 0 || cluster.isRemote) return false;
  const region = regionOfVacancy({
    location: cluster.canonicalLocation,
    country: cluster.companyFeatures?.country,
  });
  return Boolean(region) && !new Set<PlaceRegion>(regions).has(region as PlaceRegion);
}

/**
 * Помечает записи вне выбранных или профильных рынков. При одинаковом
 * соответствии роли и требованиям такие офисы стоят после удалённых, местных
 * и неизвестных мест. Удалёнка
 * и место, которого словарь не знает, «вне географии» не считаются.
 */
export function markGeography<T extends GeographyMatch>(
  matched: readonly T[],
  regions: readonly CandidateRegion[],
): T[] {
  if (regions.length === 0) return [...matched];
  const marked = matched.map((item) => {
    if (isOutsideGeography(item.cluster, regions))
      return { ...item, explanation: { ...item.explanation, outsideGeography: true } };
    const remoteCountry = remoteCountryFit(item.cluster, regions);
    return remoteCountry ? { ...item, explanation: { ...item.explanation, remoteCountry } } : item;
  });
  return marked.sort(compareMatchedVacancies);
}

/**
 * Удалёнка с найма из другой страны вне условий кандидата и в подборку не
 * попадает (27.10); «Remote» без страны остаётся с честной пометкой.
 */
export function dropForeignRemote<
  T extends { readonly explanation: { readonly remoteCountry?: RemoteCountryFit } },
>(items: readonly T[]): T[] {
  return items.filter((item) => item.explanation.remoteCountry !== 'other');
}
