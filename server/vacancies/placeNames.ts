import directory from '../../shared/geo/geoDirectory.json';

/**
 * Написания стран и блоков стран в объявлениях (03.11): общий словарь для
 * области удалёнки и места вакансии. Короткие коды («US», «UK») — только
 * заглавными, падежи — те, что пишет hh.ru.
 */
/** Блоки стран: код блока ← написания в объявлениях. */
const BLOCK_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['EMEA', 'emea'],
  ['EUROPE', 'europe'],
  ['EUROPE', 'европ'],
  ['EU', 'european union'],
  ['CIS', 'cis'],
  ['CIS', 'снг'],
  ['MENA', 'mena'],
  ['MENA', 'middle east'],
  ['APAC', 'apac'],
  ['APAC', 'asia pacific'],
  ['APAC', 'asia-pacific'],
  ['LATAM', 'latam'],
  ['LATAM', 'latin america'],
  ['LATAM', 'south america'],
  ['AMERICAS', 'americas'],
  ['AMERICAS', 'amer'],
  ['NORTH_AMERICA', 'north america'],
];

/** Короткие написания: только с заглавными, иначе «join us» стал бы США. */
const CASED_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['US', 'US'],
  ['US', 'U.S.'],
  ['US', 'U.S'],
  ['US', 'USA'],
  ['GB', 'UK'],
  ['AE', 'UAE'],
  ['RU', 'РФ'],
  ['EU', 'EU'],
];

/** Падежи стран, которые пишет hh.ru: «из любой точки России». */
const RUSSIAN_FORMS: ReadonlyArray<readonly [string, string]> = [
  ['RU', 'россии'],
  ['RU', 'российской федерации'],
  ['BY', 'беларуси'],
  ['BY', 'белоруссии'],
  ['KZ', 'казахстана'],
  ['UA', 'украины'],
  ['AM', 'армении'],
  ['GE', 'грузии'],
  ['UZ', 'узбекистана'],
  ['RS', 'сербии'],
  ['CY', 'кипра'],
  ['AE', 'оаэ'],
  ['US', 'united states of america'],
  ['GB', 'great britain'],
  ['GB', 'england'],
  ['NL', 'netherlands'],
  ['CZ', 'czech republic'],
  ['TR', 'türkiye'],
  ['KR', 'korea'],
  ['US', 'nyc'],
  ['US', 'bay area'],
  // Штаты и провинции без страны: «Remote - California». Georgia — страна, её нет.
  ...[
    'alabama',
    'alaska',
    'arizona',
    'arkansas',
    'california',
    'colorado',
    'connecticut',
    'delaware',
    'florida',
    'hawaii',
    'idaho',
    'illinois',
    'indiana',
    'iowa',
    'kansas',
    'kentucky',
    'louisiana',
    'maine',
    'maryland',
    'massachusetts',
    'michigan',
    'minnesota',
    'mississippi',
    'missouri',
    'montana',
    'nebraska',
    'nevada',
    'new hampshire',
    'new jersey',
    'new mexico',
    'north carolina',
    'north dakota',
    'ohio',
    'oklahoma',
    'oregon',
    'pennsylvania',
    'rhode island',
    'south carolina',
    'south dakota',
    'tennessee',
    'texas',
    'utah',
    'vermont',
    'virginia',
    'washington dc',
    'west virginia',
    'wisconsin',
    'wyoming',
  ].map((state) => ['US', state] as const),
  ...['ontario', 'quebec', 'british columbia', 'alberta', 'manitoba', 'nova scotia'].map(
    (province) => ['CA', province] as const,
  ),
];

const COUNTRY_NAMES: ReadonlyArray<readonly [string, string]> = [
  ...(directory.countries as readonly (readonly string[])[]).flatMap(([iso, ru, en]) => [
    [iso, ru.toLowerCase()] as const,
    [iso, en.toLowerCase()] as const,
    // «The Netherlands» пишут и без артикля.
    [iso, en.toLowerCase().replace(/^the /u, '')] as const,
  ]),
  ...RUSSIAN_FORMS,
];

export const ISO_BY_RUSSIAN_LABEL: ReadonlyMap<string, string> = new Map(
  (directory.countries as readonly (readonly string[])[]).map(([iso, ru]) => [ru, iso]),
);

export const KNOWN_ISO: ReadonlySet<string> = new Set(ISO_BY_RUSSIAN_LABEL.values());

const NAME_TO_AREA: ReadonlyMap<string, string> = new Map(
  [...COUNTRY_NAMES, ...BLOCK_NAMES].map(([code, name]) => [name, code]),
);

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function alternation(names: readonly string[]): string {
  return [...names]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|');
}

const NAME_PATTERN = new RegExp(
  `(?<![\\p{L}])(${alternation([...NAME_TO_AREA.keys()])})(?![\\p{L}])`,
  'giu',
);
const CASED_PATTERN = new RegExp(
  `(?<![\\p{L}.])(${alternation(CASED_ALIASES.map(([, alias]) => alias))})(?![\\p{L}])`,
  'gu',
);
const CASED_TO_AREA: ReadonlyMap<string, string> = new Map(
  CASED_ALIASES.map(([code, alias]) => [alias, code]),
);

/** Области, названные в куске текста. */
export function areasIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(NAME_PATTERN)) {
    const area = NAME_TO_AREA.get(match[1].toLowerCase());
    if (area) found.push(area);
  }
  for (const match of text.matchAll(CASED_PATTERN)) {
    const area = CASED_TO_AREA.get(match[1]);
    if (area) found.push(area);
  }
  return found;
}
