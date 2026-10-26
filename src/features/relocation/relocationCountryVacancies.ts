import { useEffect, useState } from 'react';
import type { MatchedVacancyPlaceFacet } from '../../../shared/matchedVacancyFacets';
import type {
  CountryComparisonCountry,
  CountryComparisonFact,
} from '../../../shared/countryFit/countryComparison';
import { getMatchedVacancyPage } from '../coach/matchedVacancyApi';
import { localIsoDate } from './relocationDates';

/** The candidate's matched pool as places with counts: the first page's facets cover the whole pool. */
export interface CountryVacancySample {
  readonly places: readonly MatchedVacancyPlaceFacet[];
  readonly total: number;
  readonly capturedAt: string;
}

const SCOPE = 'подборка по вашим ролям';
const CACHE_MS = 5 * 60_000;
let cached: { readonly at: number; readonly read: Promise<CountryVacancySample | null> } | null =
  null;

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/gu, 'е')
    .replace(/[.()]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function displayName(locale: string, code: string): string | undefined {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code);
  } catch {
    return undefined;
  }
}

/** ISO code, Russian and English names of the country: the pool stores either. */
function countryAliases(countryCode: string): ReadonlySet<string> {
  const names = [countryCode, displayName('ru', countryCode), displayName('en', countryCode)];
  return new Set(names.filter((name): name is string => Boolean(name)).map(normalise));
}

function placeInCountry(place: MatchedVacancyPlaceFacet, aliases: ReadonlySet<string>): boolean {
  if (place.country) return aliases.has(normalise(place.country));
  const last = place.location?.split(',').at(-1);
  return last ? aliases.has(normalise(last)) : false;
}

export function countryVacancyCount(sample: CountryVacancySample, countryCode: string): number {
  const aliases = countryAliases(countryCode);
  return sample.places
    .filter((place) => placeInCountry(place, aliases))
    .reduce((sum, place) => sum + place.count, 0);
}

/** «31 вакансия» with the Russian plural. */
export function vacancyCountLabel(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  const word =
    tens >= 11 && tens <= 14
      ? 'вакансий'
      : ones === 1
        ? 'вакансия'
        : ones >= 2 && ones <= 4
          ? 'вакансии'
          : 'вакансий';
  return `${count} ${word}`;
}

/** «Вакансий» of the comparison: a count out of the dated pool, or no row when the pool is unread. */
export function countryVacancyFact(
  sample: CountryVacancySample | null | undefined,
  countryCode: string,
): CountryComparisonCountry['facts']['relocationVacancies'] {
  if (!sample || sample.total < 1)
    return { status: 'no_data', reason: 'Подборка вакансий ещё не прочитана.' };
  return {
    status: 'available',
    value: {
      count: countryVacancyCount(sample, countryCode),
      sampleSize: sample.total,
      scope: SCOPE,
      periodStart: sample.capturedAt,
      periodEnd: sample.capturedAt,
    },
    sources: [
      {
        kind: 'vacancy_catalog',
        title: 'Подборка вакансий',
        capturedAt: sample.capturedAt,
        sampleSize: sample.total,
      },
    ],
  } satisfies CountryComparisonFact<unknown>;
}

async function readSample(): Promise<CountryVacancySample | null> {
  try {
    const page = await getMatchedVacancyPage(0);
    if (!page.facets?.places) return null;
    return { places: page.facets.places, total: page.facets.total, capturedAt: localIsoDate() };
  } catch {
    // No pool, no count: the rows that need it are not shown (owner rule, no «нет данных»).
    return null;
  }
}

/** One cached read per five minutes for every country card, push screen and comparison. */
export function useCountryVacancySample(): CountryVacancySample | null {
  const [sample, setSample] = useState<CountryVacancySample | null>(null);
  useEffect(() => {
    let active = true;
    if (!cached || Date.now() - cached.at > CACHE_MS)
      cached = { at: Date.now(), read: readSample() };
    void cached.read.then((value) => {
      if (active) setSample(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return sample;
}

export function resetCountryVacancySampleCache(): void {
  cached = null;
}
