import { z } from 'zod';
import { RUSSIAN_CITY_DISTRICT } from '../../shared/locationGazetteer';
import { latinCityName } from '../../shared/placeNames';
import { russianCityName, SALARY_COUNTRY_CITIES } from '../../shared/salaryCountryCities';
import { supportedCountryCodes } from '../../shared/taxData';

/**
 * B672: места релокации кандидата — страны с налоговой шкалой и города России
 * (без визы). Список хранится между визитами вместе с разделами трат,
 * отмеченными «Не про меня»: они не входят в остаток на жизнь.
 */

/** Страны, где есть и города каталога, и проверенная налоговая шкала. */
export const RELOCATION_PAY_COUNTRIES: readonly string[] = Object.keys(
  SALARY_COUNTRY_CITIES,
).filter((code) => supportedCountryCodes.some((supported) => supported === code));

/** Разделы трат строки места; совпадают с полями сценария релокации. */
export const COST_SECTION_KEYS = [
  'rent',
  'utilities',
  'food',
  'transport',
  'insurance',
  'education',
  'other',
  'moving',
  'deposit',
] as const;

export const MAX_PLACES = 12;

/** Города России, у которых есть страница каталога: slug → русское имя. */
export const RUSSIAN_CITIES: ReadonlyMap<string, string> = new Map(
  Object.keys(RUSSIAN_CITY_DISTRICT).flatMap((name) => {
    const slug = latinCityName(name);
    return slug ? [[slug, russianCityName(slug, name)] as const] : [];
  }),
);

const skipped = z.array(z.enum(COST_SECTION_KEYS)).max(COST_SECTION_KEYS.length);

const placeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('country'),
      code: z.string().refine((code) => RELOCATION_PAY_COUNTRIES.includes(code)),
      skipped,
    })
    .strict(),
  z
    .object({
      kind: z.literal('city'),
      slug: z.string().refine((slug) => RUSSIAN_CITIES.has(slug)),
      skipped,
    })
    .strict(),
]);

export type RelocationPlaceChoice = z.infer<typeof placeSchema>;

export function placeKey(place: RelocationPlaceChoice): string {
  return place.kind === 'country' ? `country:${place.code}` : `city:${place.slug}`;
}

export const placesSchema = z
  .object({ places: z.array(placeSchema).max(MAX_PLACES) })
  .strict()
  .refine((body) => new Set(body.places.map(placeKey)).size === body.places.length);

export interface RussianCityRow {
  readonly slug: string;
  readonly name: string;
  readonly vacancies: number;
}

/** Города России с вакансиями каталога, крупные первыми. */
export function russianCityRows(
  counts: readonly { readonly slug: string; readonly count: number }[],
): RussianCityRow[] {
  return counts
    .filter((row) => row.count > 0 && RUSSIAN_CITIES.has(row.slug))
    .map((row) => ({ slug: row.slug, name: RUSSIAN_CITIES.get(row.slug)!, vacancies: row.count }))
    .sort((a, b) => b.vacancies - a.vacancies);
}
