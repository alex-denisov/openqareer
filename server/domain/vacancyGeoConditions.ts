/**
 * 02.11 (owner audit, 32 vacancies): 0 of 6 failed conditions reached «Не подходит по условиям».
 * The model rarely extracts an onsite city or a country-only remote, so these conditions are read
 * from the vacancy itself and checked against the campaign geography and the profile location.
 */
import type { VacancyFitConditionBlock } from '../../shared/vacancyFit';
import { matchesLocationSelection, parseVacancyLocation } from '../../shared/locationTree';
import '../../shared/geo/serverGeoDirectory';

export interface GeoConditionTarget {
  readonly description: string;
  readonly location?: string;
  readonly isRemote: boolean;
}
export interface GeoConditionContext {
  /** Location-tree keys of the cities the campaign accepts («Россия › … › Москва»). */
  readonly places: readonly string[];
  /** Countries a remote job may be done from: the campaign's home country and where the candidate lives. */
  readonly countries: readonly string[];
  /** The profile location as the candidate wrote it, quoted on the card. */
  readonly candidateLocation?: string;
}

const COUNTRY_WORDS: readonly (readonly [RegExp, string])[] = [
  [/^(?:usa|u\.s\.a?\.?|us|united states(?: of america)?)$/iu, 'США'],
  [/^(?:uk|united kingdom|great britain)$/iu, 'Великобритания'],
  [/^(?:canada)$/iu, 'Канада'],
  [/^(?:australia)$/iu, 'Австралия'],
  [/^(?:germany)$/iu, 'Германия'],
  [/^(?:eu|european union)$/iu, 'ЕС'],
];
const COUNTRY = String.raw`(USA|U\.S\.A?\.?|US|United States(?: of America)?|United Kingdom|UK|Canada|Australia|Germany|EU|European Union)`;
/** «Remote - USA», «remotely (within the US)», «located within the US», «eligible to work in the US». */
const COUNTRY_ONLY = [
  new RegExp(
    String.raw`\bremote(?:ly)?\s*(?:[-–—:|]\s*|\(\s*|\s+)(?:only\s+)?(?:(?:with)?in|from)?\s*(?:the\s+)?${COUNTRY}(?![\w-])`,
    'iu',
  ),
  new RegExp(
    String.raw`\b(?:located|reside|residing|based|eligible to work|authori[sz]ed to work|right to work)\s+(?:with)?in\s+(?:the\s+)?${COUNTRY}(?![\w-])`,
    'iu',
  ),
];
const ONSITE_LINE = /\((?:hybrid|on-?site|in office)\)|\b(?:hybrid|on-?site)\b|в офисе|гибрид/iu;

function countryOfWord(word: string): string | undefined {
  return COUNTRY_WORDS.find(([pattern]) => pattern.test(word.trim()))?.[1];
}

function countryOnlyBlock(
  target: GeoConditionTarget,
  geo: GeoConditionContext,
): VacancyFitConditionBlock | null {
  for (const pattern of COUNTRY_ONLY) {
    const match = target.description.match(pattern);
    const country = match ? countryOfWord(match[1]!) : undefined;
    if (!match || !country || geo.countries.includes(country)) continue;
    return {
      requirementId: 'geo:country',
      text: `работа только из страны ${country} («${match[0].trim()}»)`,
      quote: quoteOf(geo),
    };
  }
  return null;
}

/** Places the job must be done at: the row location when not remote, and lines marked hybrid or onsite. */
function onsitePlaces(target: GeoConditionTarget): readonly string[] {
  const lines = target.description
    .split('\n')
    .filter((line) => ONSITE_LINE.test(line) && line.length <= 120)
    .map((line) =>
      line
        .replace(/^[\s\-•*]+/u, '')
        .replace(ONSITE_LINE, '')
        .trim(),
    );
  return [...(target.isRemote || !target.location ? [] : [target.location]), ...lines].filter(
    Boolean,
  );
}

function onsiteBlock(
  target: GeoConditionTarget,
  geo: GeoConditionContext,
): VacancyFitConditionBlock | null {
  if (!geo.places.length) return null;
  const home = geo.candidateLocation
    ? parseVacancyLocation({ location: geo.candidateLocation })
    : undefined;
  const places = onsitePlaces(target).flatMap((location) => {
    const path = parseVacancyLocation({ location });
    return path?.city ? [{ location, path }] : [];
  });
  if (!places.length) return null;
  const fits = places.some(
    ({ location, path }) =>
      matchesLocationSelection({ location }, geo.places) ||
      (home?.city !== undefined && home.city === path.city),
  );
  if (fits) return null;
  const cities = [...new Set(places.map(({ path }) => path.city))].join(', ');
  return { requirementId: 'geo:onsite', text: `работа на месте: ${cities}`, quote: quoteOf(geo) };
}

function quoteOf(geo: GeoConditionContext): string {
  return geo.candidateLocation
    ? `Местоположение: ${geo.candidateLocation}`
    : 'География поиска кампании';
}

/** Conditions the vacancy states and the campaign geography or the profile location fails. */
export function geoConditionBlocks(
  target: GeoConditionTarget,
  geo: GeoConditionContext,
): readonly VacancyFitConditionBlock[] {
  return [countryOnlyBlock(target, geo), onsiteBlock(target, geo)].filter(
    (block): block is VacancyFitConditionBlock => block !== null,
  );
}
