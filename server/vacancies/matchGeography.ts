import { geoCityNames, geoCountryNames } from '../../shared/geo/geoDirectory';
import type { CareerGeography } from './careerGeography';

/**
 * География подбора для SQL: написания городов «Карьеры» и признак удалёнки.
 * Это надмножество: точную проверку делает `withinCareerGeography` после
 * чтения, здесь только не тратится предел чтения на чужие города.
 */
export interface MatchGeography {
  readonly cityNames: readonly string[];
  readonly remote: boolean;
}

const PATH_SEPARATOR = ' › ';

/**
 * `undefined` — фильтра в SQL нет: мест нет, или место не город справочника
 * («Россия», округ). Строка вакансии хранит город, и страна в SQL совпала бы
 * с пустотой — тогда точную проверку делает только `withinCareerGeography`.
 */
export function matchGeographyOf(
  career: CareerGeography | null | undefined,
): MatchGeography | undefined {
  if (!career || career.places.length === 0) return undefined;
  const perPlace = career.places.map((place) => {
    const last = place.split(PATH_SEPARATOR).at(-1)?.trim();
    const city = geoCityNames(last);
    // Страна рядом с городом не снимает фильтр: без него окно чтения делится
    // на весь мир и вытесняет города из условий (03.11: +«ОАЭ» — 402 → 230).
    return city.length > 0 || career.places.length === 1 ? city : geoCountryNames(last);
  });
  if (perPlace.some((names) => names.length === 0)) return undefined;
  return { cityNames: Array.from(new Set(perPlace.flat())), remote: career.remote };
}

export function matchGeographyKey(geography: MatchGeography | undefined): string {
  if (!geography) return '';
  return `${geography.remote ? 'r' : ''}:${[...geography.cityNames].sort().join('|')}`;
}
