/**
 * B803: страна вакансии, у которой место не названо прямо («Remote», «2 Locations», «8038 Zürich, ZH»,
 * пусто). Порядок — от места в тексте к адресу вакансии и к стране работодателя; ничего не нашли или
 * признаки спорят — страны нет.
 */
export type CountryHintBasis = 'place' | 'address' | 'employer' | 'domain';

export interface CountryHint {
  readonly country: string;
  readonly basis: CountryHintBasis;
}

export interface CountryHintInput {
  readonly location: string | null | undefined;
  readonly company: string;
  readonly urls: readonly string[];
}

export interface CountryHintDeps {
  /** Страна места по общему разбору. */
  readonly resolvePlace: (place: string) => string | undefined;
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
const NAME_ALIASES: Readonly<Record<string, string>> = {
  'hong kong': 'HK',
  'hong kong sar': 'HK',
  гонконг: 'HK',
  оаэ: 'AE',
  uae: 'AE',
  uk: 'GB',
  великобритания: 'GB',
  usa: 'US',
  сша: 'US',
  турция: 'TR',
  turkey: 'TR',
  الرياض: 'SA',
  deutschland: 'DE',
  österreich: 'AT',
  schweiz: 'CH',
};

function countryName(text: string): string | undefined {
  const name = text.trim().toLocaleLowerCase('ru');
  return NAME_ALIASES[name] ?? COUNTRY_NAMES.get(name);
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
    .split(/[;|/·,()]+/u)
    .map((part) => part.replace(/\s+/gu, ' ').trim())
    .filter((part) => part.length > 1)
    .slice(0, MAX_PLACES);
}

function single(codes: readonly (string | undefined)[]): string | undefined {
  const known = new Set(codes.filter((code) => code !== undefined));
  return known.size === 1 ? [...known][0] : undefined;
}

function placeCountry(location: string, deps: CountryHintDeps): string | undefined {
  const parts = placesOf(location);
  const named = parts.map(countryName).filter((code) => code !== undefined);
  if (named.length > 0) return single(named);
  const [first] = parts;
  if (!first) return undefined;
  return deps.resolvePlace(parts.join(', ')) ?? deps.resolvePlace(first);
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
  /(?:^|\.)(?:hh\.ru|indeed\.[a-z.]+|linkedin\.[a-z]+|arbeitnow\.[a-z]+|breezy\.hr|grnh\.se|personio\.[a-z]+|teamtailor\.[a-z]+|jobvite\.[a-z]+|join\.[a-z]+)$/u;

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

export function vacancyCountryHint(
  input: CountryHintInput,
  deps: CountryHintDeps,
): CountryHint | undefined {
  const urls = parsedUrls(input.urls);
  const steps: readonly [CountryHintBasis, () => string | undefined][] = [
    ['place', () => (input.location ? placeCountry(input.location, deps) : undefined)],
    ['address', () => addressCountry(urls, deps)],
    ['employer', () => deps.employerCountry(input.company)],
    ['domain', () => single(urls.map(domainCountry))],
  ];
  for (const [basis, read] of steps) {
    const country = read();
    if (country) return { country, basis };
  }
  return undefined;
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
