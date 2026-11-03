import type { CandidateRegion } from '../src/features/workspace/candidateRegions';
import { countryNameRu } from './geo/countryNames';

/**
 * Откуда можно работать на удалёнке (03.11, «Infrastructure Manager» TIDI:
 * «Remote» в месте, «anywhere in US» в тексте). Хранится строкой проекции:
 * `global` — страна не названа, работать можно откуда угодно; иначе список
 * через запятую из кодов ISO 3166-1 («US», «RU») и блоков («EMEA», «EU»).
 */
export type RemoteScope =
  { readonly kind: 'global' } | { readonly kind: 'restricted'; readonly areas: readonly string[] };

export const GLOBAL_REMOTE_SCOPE = 'global';

/** Блоки стран, которые называют объявления, и регионы платформы внутри них. */
export const REMOTE_SCOPE_BLOCKS: Readonly<
  Record<string, { readonly label: string; readonly regions: readonly CandidateRegion[] }>
> = {
  // EMEA и Европа по определению включают Россию; Евросоюз — нет.
  EMEA: { label: 'EMEA', regions: ['eu', 'mena', 'ru', 'cis'] },
  EUROPE: { label: 'Европа', regions: ['eu', 'ru', 'cis'] },
  EU: { label: 'Евросоюз', regions: ['eu'] },
  CIS: { label: 'СНГ', regions: ['ru', 'cis'] },
  MENA: { label: 'Ближний Восток', regions: ['mena'] },
  APAC: { label: 'Азия и Океания', regions: ['apac'] },
  LATAM: { label: 'Латинская Америка', regions: ['latam'] },
  AMERICAS: { label: 'Америка', regions: ['us', 'latam'] },
  NORTH_AMERICA: { label: 'Северная Америка', regions: ['us'] },
};

const REGION_COUNTRIES: Readonly<Record<CandidateRegion, readonly string[]>> = {
  ru: ['RU'],
  cis: ['UA', 'KZ', 'GE', 'AM', 'UZ', 'AZ', 'BY', 'KG', 'MD', 'TJ', 'TM'],
  us: ['US', 'CA'],
  eu: [
    'GB',
    'DE',
    'FR',
    'NL',
    'ES',
    'IT',
    'IE',
    'PL',
    'PT',
    'SE',
    'CH',
    'AT',
    'BE',
    'CZ',
    'DK',
    'FI',
    'NO',
    'RO',
    'CY',
    'RS',
    'GR',
    'HU',
    'LT',
    'LV',
    'EE',
    'BG',
    'HR',
    'ME',
    'SK',
    'SI',
    'LU',
    'MT',
    'IS',
    'AL',
    'BA',
    'MK',
    'XK',
    'GI',
    'AD',
    'MC',
    'SM',
    'LI',
    'VA',
  ],
  mena: [
    'AE',
    'SA',
    'QA',
    'KW',
    'BH',
    'OM',
    'EG',
    'MA',
    'IL',
    'TR',
    'JO',
    'LB',
    'TN',
    'DZ',
    'IQ',
    'IR',
    'LY',
    'SY',
    'YE',
    'PS',
  ],
  apac: [
    'IN',
    'SG',
    'AU',
    'JP',
    'HK',
    'MY',
    'PH',
    'ID',
    'KR',
    'NZ',
    'VN',
    'TH',
    'CN',
    'TW',
    'PK',
    'BD',
    'LK',
    'NP',
    'KH',
    'MM',
    'MN',
    'LA',
    'AF',
  ],
  latam: [
    'BR',
    'MX',
    'AR',
    'CL',
    'CO',
    'PE',
    'UY',
    'CR',
    'NI',
    'GT',
    'PA',
    'EC',
    'VE',
    'DO',
    'HN',
    'SV',
    'BO',
    'PY',
    'JM',
    'BS',
    'SR',
    'GY',
    'BZ',
    'HT',
    'CU',
    'TT',
    'BB',
    'PR',
  ],
};

const REGION_OF_COUNTRY: ReadonlyMap<string, CandidateRegion> = new Map(
  Object.entries(REGION_COUNTRIES).flatMap(([region, codes]) =>
    codes.map((code) => [code, region as CandidateRegion] as const),
  ),
);

const LISTED_AREAS = 3;

export function parseRemoteScope(stored: string | undefined | null): RemoteScope | undefined {
  const text = stored?.trim();
  if (!text) return undefined;
  if (text === GLOBAL_REMOTE_SCOPE) return { kind: 'global' };
  const areas = text
    .split(',')
    .map((area) => area.trim())
    .filter(Boolean);
  return areas.length > 0 ? { kind: 'restricted', areas } : undefined;
}

export function serializeRemoteScope(scope: RemoteScope): string {
  return scope.kind === 'global' ? GLOBAL_REMOTE_SCOPE : [...scope.areas].join(',');
}

function areaLabel(area: string): string {
  return REMOTE_SCOPE_BLOCKS[area]?.label ?? countryNameRu(area);
}

/** Одна русская подпись удалёнки — без английского «Remote» рядом (03.11). */
export function remoteScopeLabel(scope: RemoteScope | undefined): string {
  if (!scope) return 'Удалённо';
  if (scope.kind === 'global') return 'Удалённо из любой страны';
  const [first, ...rest] = scope.areas;
  if (rest.length === 0) {
    return REMOTE_SCOPE_BLOCKS[first]
      ? `Удалённо, ${areaLabel(first)}`
      : `Удалённо, только ${areaLabel(first)}`;
  }
  const shown = scope.areas.slice(0, LISTED_AREAS).map(areaLabel).join(', ');
  const hidden = scope.areas.length - LISTED_AREAS;
  return hidden > 0 ? `Удалённо: ${shown} и ещё ${hidden}` : `Удалённо: ${shown}`;
}

/** Регионы платформы, из которых можно работать; `undefined` — откуда угодно. */
export function remoteScopeRegions(scope: RemoteScope): ReadonlySet<CandidateRegion> | undefined {
  if (scope.kind === 'global') return undefined;
  const regions = new Set<CandidateRegion>();
  for (const area of scope.areas) {
    for (const region of REMOTE_SCOPE_BLOCKS[area]?.regions ?? []) regions.add(region);
    const country = REGION_OF_COUNTRY.get(area);
    if (country) regions.add(country);
  }
  return regions;
}

/** Удалёнка открыта кандидату из одного из `homeRegions`. */
export function remoteScopeAllows(
  scope: RemoteScope | undefined,
  homeRegions: readonly CandidateRegion[],
): boolean {
  if (!scope || homeRegions.length === 0) return true;
  const regions = remoteScopeRegions(scope);
  return !regions || homeRegions.some((region) => regions.has(region));
}

/** Коды и блоки, при которых удалёнка открыта региону: для фильтра в SQL. */
export function remoteScopeAreasOf(region: CandidateRegion): string[] {
  const blocks = Object.entries(REMOTE_SCOPE_BLOCKS)
    .filter(([, block]) => block.regions.includes(region))
    .map(([code]) => code);
  return [...REGION_COUNTRIES[region], ...blocks];
}
