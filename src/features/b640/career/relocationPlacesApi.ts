import { apiFetch, readData } from '../../coach/apiClient';
import type { CostKey } from './relocationCostsModel';

const BASE = '/api/v1/candidate/career/relocation';

/** Выбранное место: страна со шкалой налогов или город России; «Не про меня» — по разделам трат. */
export type PlaceChoice =
  | { readonly kind: 'country'; readonly code: string; readonly skipped: readonly CostKey[] }
  | { readonly kind: 'city'; readonly slug: string; readonly skipped: readonly CostKey[] };

export interface SavedPlaces {
  readonly saved: boolean;
  readonly places: readonly PlaceChoice[];
  readonly updatedAt: string | null;
}

export interface RussianCity {
  readonly slug: string;
  readonly name: string;
  readonly vacancies: number;
}

export type CityPay =
  | {
      readonly state: 'ready';
      readonly scope: 'role' | 'city';
      readonly currency: string;
      readonly low: number;
      readonly median: number;
      readonly high: number;
      readonly sampleSize: number;
      readonly observedAt: string;
    }
  | { readonly state: 'thin' };

export const choiceKey = (choice: PlaceChoice): string =>
  choice.kind === 'country' ? `country:${choice.code}` : `city:${choice.slug}`;

export async function getSavedPlaces(signal?: AbortSignal): Promise<SavedPlaces> {
  return readData<SavedPlaces>(await apiFetch(`${BASE}/places`, { signal }));
}

export async function putPlaces(places: readonly PlaceChoice[]): Promise<SavedPlaces> {
  return readData<SavedPlaces>(
    await apiFetch(`${BASE}/places`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ places }),
    }),
  );
}

export async function getRussianCities(signal?: AbortSignal): Promise<readonly RussianCity[]> {
  const data = await readData<{ cities: readonly RussianCity[] }>(
    await apiFetch(`${BASE}/cities`, { signal }),
  );
  return data.cities;
}

export async function getCityPay(
  city: string,
  role: string | null,
  signal?: AbortSignal,
): Promise<CityPay> {
  const query = new URLSearchParams({ city, ...(role ? { role } : {}) });
  return readData<CityPay>(await apiFetch(`${BASE}/pay?${query.toString()}`, { signal }));
}

/** Новый список мест с разделом «Не про меня» у одного места (или без него). */
export function withSkip(
  places: readonly PlaceChoice[],
  key: string,
  section: CostKey,
  skip: boolean,
): PlaceChoice[] {
  return places.map((place) => {
    if (choiceKey(place) !== key) return place;
    const rest = place.skipped.filter((item) => item !== section);
    return { ...place, skipped: skip ? [...rest, section] : rest };
  });
}
