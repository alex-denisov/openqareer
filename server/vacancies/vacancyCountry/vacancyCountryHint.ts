/**
 * B803: страна вакансии, у которой место не названо прямо («Remote», «2 Locations», «8038 Zürich, ZH»,
 * пусто). Порядок — от места в тексте к адресу вакансии и к стране работодателя; ничего не нашли или
 * признаки спорят — страны нет.
 */
import type { Cities } from './cityCountry';

/** `place` — страна или штат названы, либо место знает общий разбор; `city` — догадка по словарю. */
export type CountryHintBasis = 'place' | 'city' | 'address' | 'employer' | 'domain' | 'text';

export interface CountryHint {
  readonly country: string;
  readonly basis: CountryHintBasis;
  /** Страна из описания верна в 86 % (прод 25.11): пометка сервера, в ответ API не входит. */
  readonly lowConfidence: boolean;
}

export interface CountryHintInput {
  readonly location: string | null | undefined;
  readonly company: string;
  readonly urls: readonly string[];
  /** Начало описания вакансии. */
  readonly text?: string;
}

export interface CountryHintDeps {
  /** Страна места по общему разбору. */
  readonly resolvePlace: (place: string) => string | undefined;
  readonly cities: Cities;
  readonly employerCountry: (company: string) => string | undefined;
}

const ISO_CODES =
  'AE AL AM AR AT AU AZ BA BD BE BG BH BR BY CA CH CL CN CO CR CY CZ DE DK DO DZ EC EE EG ES FI FR GB GE GH GR GT HK HR HU ID IE IL IN IQ IS IT JO JP KE KG KR KW KZ LB LK LT LU LV MA MD ME MK MM MT MX MY NG NL NO NP NZ OM PA PE PH PK PL PT PY QA RO RS RU SA SE SG SI SK TH TN TR TW TZ UA UG US UY UZ VN ZA'.split(
    ' ',
  );

const COUNTRY_NAMES: ReadonlyMap<string, string> = new Map(
  ['en', 'ru'].flatMap((language) => {
    const names = new Intl.DisplayNames([language], { type: 'region' });
    return ISO_CODES.map(
      (code) => [(names.of(code) ?? code).toLocaleLowerCase('ru'), code] as const,
    );
  }),
);
const NAME_ALIASES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    'hong kong': 'HK',
    'hong kong sar': 'HK',
    гонконг: 'HK',
    оаэ: 'AE',
    uae: 'AE',
    macedonia: 'MK',
    uk: 'GB',
    великобритания: 'GB',
    usa: 'US',
    us: 'US',
    сша: 'US',
    турция: 'TR',
    turkey: 'TR',
    الرياض: 'SA',
    deutschland: 'DE',
    österreich: 'AT',
    schweiz: 'CH',
  }),
);

function countryName(text: string): string | undefined {
  const name = text.trim().toLocaleLowerCase('ru');
  return NAME_ALIASES.get(name) ?? COUNTRY_NAMES.get(name);
}

const NOISE = [
  /\b(?:anywhere|remote|hybrid|based|homeoffice|home office|work from home)\b(?:\s+(?:in|from))?/giu,
  /\b(?:greater|metropolitan|metro|area|region|office|hq|headquarters|campus|county|district)\b/giu,
  /удал[её]нно|гибрид/giu,
  /(?<!\p{L})\d{3,6}(?:[ -]\d{3,4})?(?!\p{L})/gu,
];
const MAX_PLACES = 8;

/** Места, которые можно прочитать в строке: страна, затем город без индекса и слова «Area». */
function placesOf(location: string): string[] {
  const bare = NOISE.reduce((text, noise) => text.replace(noise, ' '), location);
  return bare
    .split(/[,()]+/u)
    .map((part) => part.replace(/\s+/gu, ' ').trim())
    .filter((part) => part.length > 1)
    .slice(0, MAX_PLACES);
}

function single(codes: readonly (string | undefined)[]): string | undefined {
  const known = new Set(codes.filter((code) => code !== undefined));
  return known.size === 1 ? [...known][0] : undefined;
}

const US_STATES: ReadonlySet<string> = new Set(
  (
    'alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|' +
    'illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|' +
    'mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|' +
    'north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|' +
    'south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming'
  ).split('|'),
);

const US_STATE_CODES: ReadonlySet<string> = new Set(
  (
    'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM ' +
    'NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'
  ).split(' '),
);
const PROVINCE_CODES: ReadonlySet<string> = new Set(
  'ON BC AB MB SK NS NB QC PE NL NT YT NU'.split(' '),
);
/** Тот же код — регион другой страны (Западная Австралия, Милан, Санта-Катарина, Северная Голландия). */
const FOREIGN_REGIONS: ReadonlyMap<string, string> = new Map(
  Object.entries({ WA: 'AU', NT: 'AU', MI: 'IT', MO: 'IT', SC: 'BR', NH: 'NL', NB: 'NL' }),
);
/** Города США с именем страны: «Lebanon, NH», «Jordan, Minnesota». */
const COUNTRY_NAMESAKES: ReadonlySet<string> = new Set(
  'lebanon peru jordan mexico cuba panama poland norway denmark china italy ireland brazil greece egypt turkey chile georgia'.split(
    ' ',
  ),
);
/** Штат, который чаще пишут как город. */
const STATE_CITIES: ReadonlySet<string> = new Set(['new york', 'washington']);

interface PlaceRead {
  readonly country: string;
  readonly basis: 'place' | 'city';
}
/** Место сузило выбор до двух стран: решают следующие признаки, при их молчании — `otherwise`. */
interface OpenRead {
  readonly among: readonly string[];
  readonly otherwise?: string;
}
type PlaceAnswer = PlaceRead | OpenRead | 'dispute' | undefined;

const isOpen = (answer: PlaceAnswer): answer is OpenRead =>
  typeof answer === 'object' && 'among' in answer;
const isRead = (answer: PlaceAnswer): answer is PlaceRead =>
  typeof answer === 'object' && 'country' in answer;

const read = (country: string | undefined, basis: PlaceRead['basis']): PlaceAnswer =>
  country ? { country, basis } : undefined;

function agreed(answers: readonly PlaceAnswer[]): PlaceAnswer {
  const reads = answers.filter((answer) => answer !== undefined);
  if (reads.some((answer) => answer === 'dispute')) return 'dispute';
  const places = reads.filter(isRead);
  const countries = new Set(places.map(({ country }) => country));
  const open = reads.filter(isOpen);
  if (countries.size > 1) return 'dispute';
  if (open.some(({ among }) => [...countries].some((country) => !among.includes(country))))
    return 'dispute';
  if (countries.size === 0 && new Set(open.map(({ among }) => among.join())).size > 1)
    return 'dispute';
  return places.length === 0
    ? open[0]
    : (places.find(({ basis }) => basis === 'place') ?? places[0]);
}

function cityRead(part: string, deps: CountryHintDeps): PlaceAnswer {
  return read(deps.resolvePlace(part), 'place') ?? read(deps.cities.country(part), 'city');
}

function regionOf(code: string): 'US' | 'CA' | undefined {
  if (US_STATE_CODES.has(code)) return 'US';
  return PROVINCE_CODES.has(code) ? 'CA' : undefined;
}

/**
 * «Lebanon, NH», «London, ON». Код, который ещё и страна (DE, IN, NL), решает город: он должен быть в
 * одной из двух стран; неясно — выбирают из этих двух следующие признаки («Warsaw, IN»).
 */
function codeRead(code: string, city: string, deps: CountryHintDeps): PlaceAnswer {
  const region = regionOf(code);
  const isCountry = ISO_CODES.includes(code);
  const found = cityRead(city, deps);
  const foreign = FOREIGN_REGIONS.get(code);
  if (isRead(found) && found.country === foreign) return found;
  if (!isCountry || COUNTRY_NAMESAKES.has(city.toLowerCase())) return read(region, 'place');
  const pair = deps.cities
    .countries(city)
    .filter((country) => country === region || country === code);
  const only = single(pair);
  if (only) return read(only, 'city');
  if (isRead(found) && [region, code].includes(found.country)) return found;
  // «Vancouver, CA»: оба города — тёзки; крупнейший отвечает, когда молчат и остальные признаки.
  return {
    among: [region, code].filter((country) => country !== undefined),
    ...(code === 'CA' && pair[0] ? { otherwise: pair[0] } : {}),
  };
}

/** «Город, штат»: полное имя штата или его код. `undefined` — штата в месте нет. */
function stateRead(
  parts: readonly string[],
  deps: CountryHintDeps,
): { readonly answer: PlaceAnswer } | undefined {
  const isState = (part: string, index: number) =>
    US_STATES.has(part.toLowerCase()) || (index > 0 && regionOf(part) !== undefined);
  const at = parts.findIndex(isState);
  const state = parts[at];
  if (state === undefined) return undefined;
  const before = parts.slice(0, at);
  const after = parts.slice(at + 1).filter((part, index) => !isState(part, index + 1));
  const named = [...before.filter((part) => !COUNTRY_NAMESAKES.has(part.toLowerCase())), ...after]
    .map(countryName)
    .filter((code) => code !== undefined);
  const us: PlaceAnswer = { country: 'US', basis: 'place' };
  if (named.length > 0) {
    const country = single(named);
    // «Amsterdam, NH, Netherlands»: названная страна важнее кода, но не полного имени штата.
    const agrees =
      regionOf(state) !== undefined || country === 'US' || deps.cities.country(state) === country;
    return { answer: (agrees ? read(country, 'place') : undefined) ?? 'dispute' };
  }
  if (regionOf(state)) return { answer: codeRead(state, before[0] ?? '', deps) };
  const others = STATE_CITIES.has(state.toLowerCase()) ? [...before, ...after] : after;
  return { answer: agreed([us, ...others.map((part) => cityRead(part, deps))]) };
}

/** «Georgia» — штат и страна: решает город, без города ответа нет. */
function georgiaRead(parts: readonly string[], deps: CountryHintDeps): PlaceAnswer {
  const others = parts.filter((part) => part.toLowerCase() !== 'georgia');
  const named = others.map(countryName).filter((code) => code !== undefined);
  if (named.length > 0) return read(single(named), 'place') ?? 'dispute';
  const city = agreed(others.map((part) => cityRead(part, deps)));
  if (!isRead(city)) return city;
  return city.country === 'US' || city.country === 'GE' ? city : 'dispute';
}

function clauseRead(clause: string, deps: CountryHintDeps): PlaceAnswer {
  const parts = placesOf(clause);
  const [first] = parts;
  if (!first) return undefined;
  const state = stateRead(parts, deps);
  if (state) return state.answer;
  if (parts.some((part) => part.toLowerCase() === 'georgia')) return georgiaRead(parts, deps);
  const named = parts.map(countryName).filter((code) => code !== undefined);
  if (named.length > 0) return read(single(named), 'place') ?? 'dispute';
  const places = agreed(
    parts.filter((part) => part.length > 2).map((part) => cityRead(part, deps)),
  );
  if (places === 'dispute') return places;
  return (
    read(deps.resolvePlace(parts.join(', ')) ?? deps.resolvePlace(first), 'place') ??
    read(deps.cities.country(first) ?? single(parts.map(deps.cities.inText)), 'city')
  );
}

/** Места через «;», «/», «|» разбираются порознь: разные страны — спор. */
function placeRead(location: string, deps: CountryHintDeps): PlaceAnswer {
  return agreed(
    location.split(/[;|/·]+|\s(?:or|или)\s/iu).map((clause) => clauseRead(clause, deps)),
  );
}

/** Workday пишет место в адрес вакансии: `/job/McLean-VA/…`. */
function workdayPlace(url: URL): string | undefined {
  if (!/\.myworkdayjobs\.com$/u.test(url.hostname)) return undefined;
  const slug = /\/job\/([^/]+)\/[^/]+/u.exec(url.pathname)?.[1];
  return slug
    ? slug
        .replace(/-+/gu, ' ')
        .trim()
        .replace(/ ([A-Z]{2})$/u, ', $1')
    : undefined;
}

const COUNTRY_TLDS: ReadonlySet<string> = new Set(
  ISO_CODES.filter((code) => !['CO', 'AI', 'IO', 'ME', 'TV', 'GE', 'SO'].includes(code)),
);

/** Площадки и системы найма обслуживают все страны: их домен ничего не говорит. */
const SHARED_HOSTS =
  /(?:^|\.)(?:hh\.ru|indeed\.[a-z.]+|linkedin\.[a-z]+|arbeitnow\.[a-z]+|breezy\.hr|grnh\.se|personio\.[a-z]+|teamtailor\.[a-z]+|jobvite\.[a-z]+|join\.[a-z]+|youtu\.be|lnkd\.in|bit\.ly|goo\.gl|t\.me|recruitee\.[a-z]+|adzuna\.[a-z.]+|stepstone\.[a-z]+|jooble\.[a-z]+|xing\.[a-z]+|glassdoor\.[a-z.]+|monster\.[a-z.]+|superjob\.ru|rabota\.ru|habr\.com|jobs\.cz|pracuj\.pl|smartrecruiters\.[a-z]+|workable\.[a-z]+|softgarden\.[a-z]+|factorial\.[a-z]+|homerun\.[a-z]+|notion\.[a-z]+|youtube\.[a-z]+|google\.[a-z.]+|facebook\.[a-z]+)$/u;

function domainCountry(url: URL): string | undefined {
  if (SHARED_HOSTS.test(url.hostname)) return undefined;
  const tld = url.hostname.split('.').at(-1)?.toUpperCase() ?? '';
  if (tld === 'UK') return 'GB';
  return COUNTRY_TLDS.has(tld) ? tld : undefined;
}

function parsedUrls(urls: readonly string[]): URL[] {
  return urls.flatMap((url) => (URL.canParse(url) ? [new URL(url)] : []));
}

function addressCountry(urls: readonly URL[], deps: CountryHintDeps): string | undefined {
  return single(
    urls.map((url) => {
      const place = workdayPlace(url);
      return place ? deps.resolvePlace(place) : undefined;
    }),
  );
}

/** Первая страна, названная в описании полным именем; коды не считаются. */
function textCountry(text: string): string | undefined {
  for (const [words] of text.matchAll(/\p{Lu}\p{L}{3,}(?:\s\p{Lu}\p{L}+)?/gu)) {
    const country = countryName(words) ?? countryName(words.split(/\s/u)[0] ?? '');
    if (country) return country;
  }
  return undefined;
}

export function vacancyCountryHint(
  input: CountryHintInput,
  deps: CountryHintDeps,
): CountryHint | undefined {
  const urls = parsedUrls(input.urls);
  const place = input.location ? placeRead(input.location, deps) : undefined;
  if (place === 'dispute') return undefined;
  if (isRead(place)) return { ...place, lowConfidence: false };
  const among = isOpen(place) ? place.among : undefined;
  const steps: readonly [CountryHintBasis, () => string | undefined][] = [
    ['address', () => addressCountry(urls, deps)],
    ['employer', () => deps.employerCountry(input.company)],
    ['domain', () => single(urls.map(domainCountry))],
    ['text', () => (input.text ? textCountry(input.text) : undefined)],
  ];
  for (const [basis, read] of steps) {
    const country = read();
    if (country && (!among || among.includes(country)))
      return { country, basis, lowConfidence: basis === 'text' };
  }
  return isOpen(place) && place.otherwise
    ? { country: place.otherwise, basis: 'city', lowConfidence: true }
    : undefined;
}

const MIN_EMPLOYER_VACANCIES = 3;
const MIN_EMPLOYER_SHARE = 0.8;

/** Страна работодателя — та, где не меньше 80 % его вакансий с известной страной. */
export function dominantEmployerCountry(counts: ReadonlyMap<string, number>): string | undefined {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const [top] = [...counts].sort((left, right) => right[1] - left[1]);
  if (!top || total < MIN_EMPLOYER_VACANCIES) return undefined;
  return top[1] / total >= MIN_EMPLOYER_SHARE ? top[0] : undefined;
}

export function employerKey(company: string): string {
  return company.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru');
}
