/**
 * Справочник географии: все страны мира и города (GeoNames CC BY 4.0, названия
 * стран — Unicode CLDR). Данные — `geoDirectory.json`, его собирает
 * `scripts/generate-geo-directory.mjs`. Файл весит ~0,5 МБ, поэтому клиент
 * грузит его отдельным чанком (`loadGeoDirectory`), а сервер регистрирует
 * сразу (`registerServerGeoDirectory`). До загрузки поиск пуст, а разбор мест
 * опирается на ручной справочник `locationGazetteer`.
 */

export interface GeoDirectoryData {
  readonly source: string;
  readonly snapshot: string;
  /** [ISO2, русское название, ...другие написания]. */
  readonly countries: readonly (readonly string[])[];
  /** «CC.admin1» → русское название региона (для России — федеральный округ). */
  readonly regions: Readonly<Record<string, string>>;
  /** [русское название, ISO2, admin1, население, ...написания латиницей в нижнем регистре]. */
  readonly cities: readonly (readonly (string | number)[])[];
}

export interface GeoCity {
  readonly label: string;
  readonly country: string;
  readonly region?: string;
  readonly population: number;
}

export type GeoPlaceKind = 'country' | 'city';

export interface GeoPlace {
  readonly kind: GeoPlaceKind;
  /** Что хранится в условиях и показывается чипом: «Москва», «Берлин, Германия», «Германия». */
  readonly value: string;
  readonly label: string;
  /** Страна и регион города, для подписи и группировки. */
  readonly context: string;
  readonly country: string;
}

interface GeoIndex {
  readonly countryByName: ReadonlyMap<string, string>;
  readonly countryLabels: readonly string[];
  readonly citiesByName: ReadonlyMap<string, readonly GeoCity[]>;
  readonly cities: readonly GeoCity[];
}

export const HOME_COUNTRY_LABEL = 'Россия';

const lower = (value: string) => value.toLocaleLowerCase('ru-RU').trim();

let index: GeoIndex | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function buildIndex(data: GeoDirectoryData): GeoIndex {
  const countryByIso = new Map<string, string>();
  const countryByName = new Map<string, string>();
  for (const [iso, label, ...names] of data.countries) {
    if (!iso || !label) continue;
    countryByIso.set(iso, label);
    for (const name of [iso, label, ...names]) countryByName.set(lower(name), label);
  }
  const cities: GeoCity[] = [];
  const citiesByName = new Map<string, GeoCity[]>();
  for (const [label, iso, admin1, population, ...aliases] of data.cities) {
    const country = countryByIso.get(String(iso));
    if (!country) continue;
    const city: GeoCity = {
      label: String(label),
      country,
      region: data.regions[`${iso}.${admin1}`],
      population: Number(population),
    };
    cities.push(city);
    for (const name of new Set([lower(city.label), ...aliases.map(String)])) {
      citiesByName.set(name, [...(citiesByName.get(name) ?? []), city]);
    }
  }
  return {
    countryByName,
    countryLabels: [...new Set(countryByIso.values())],
    citiesByName,
    cities,
  };
}

export function registerGeoDirectory(data: GeoDirectoryData): void {
  index = buildIndex(data);
  for (const listener of listeners) listener();
}

export function isGeoDirectoryReady(): boolean {
  return index !== null;
}

/** Клиент: справочник отдельным чанком, один раз на сессию. */
export function loadGeoDirectory(): Promise<void> {
  if (index) return Promise.resolve();
  pending ??= import('./geoDirectory.json')
    .then((module) => registerGeoDirectory((module.default ?? module) as GeoDirectoryData))
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
}

export function subscribeGeoDirectory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Русское название страны по любому написанию или коду ISO. */
export function geoCountry(name: string | undefined): string | undefined {
  return name ? index?.countryByName.get(lower(name)) : undefined;
}

/** Город по русскому или латинскому названию; при подсказке страны — только в ней. */
export function geoCity(name: string | undefined, country?: string): GeoCity | undefined {
  if (!name || !index) return undefined;
  const found = index.citiesByName.get(lower(name.replace(/\([^)]*\)/gu, '')));
  if (!found) return undefined;
  const scoped = country ? found.filter((city) => city.country === country) : found;
  if (country && scoped.length === 0) return undefined;
  return scoped.reduce((best, city) => (city.population > best.population ? city : best));
}

function cityValue(city: GeoCity): string {
  return city.country === HOME_COUNTRY_LABEL ? city.label : `${city.label}, ${city.country}`;
}

function cityContext(city: GeoCity): string {
  return [city.country, city.region].filter(Boolean).join(' · ');
}

const rank = (label: string, needle: string) => (lower(label).startsWith(needle) ? 0 : 1);

/**
 * Поиск мест для условий «Карьеры»: страны и города, сначала совпадение с
 * начала названия, затем Россия, затем крупнее. Пустой запрос — пусто.
 */
export function searchGeoPlaces(query: string, limit = 20): GeoPlace[] {
  const needle = lower(query);
  if (!needle || !index) return [];
  const countries: GeoPlace[] = index.countryLabels
    .filter((label) => lower(label).includes(needle))
    .sort((a, b) => rank(a, needle) - rank(b, needle) || a.localeCompare(b, 'ru-RU'))
    .map((label) => ({ kind: 'country', value: label, label, context: 'страна', country: label }));
  const cities = index.cities
    .filter((city) => lower(city.label).includes(needle))
    .sort(
      (a, b) =>
        rank(a.label, needle) - rank(b.label, needle) ||
        Number(b.country === HOME_COUNTRY_LABEL) - Number(a.country === HOME_COUNTRY_LABEL) ||
        b.population - a.population,
    )
    .map<GeoPlace>((city) => ({
      kind: 'city',
      value: cityValue(city),
      label: city.label,
      context: cityContext(city),
      country: city.country,
    }));
  return [...countries, ...cities].slice(0, limit);
}

/**
 * Запись справочника для сохранённого значения условий («Moscow», «москва»,
 * «Берлин, Германия»). `undefined` — значение не из справочника.
 */
export function resolveGeoPlace(value: string): GeoPlace | undefined {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  const country = parts.length === 1 ? geoCountry(parts[0]) : undefined;
  if (country)
    return { kind: 'country', value: country, label: country, context: 'страна', country };
  const hint = parts.length > 1 ? geoCountry(parts.at(-1)) : undefined;
  const city = geoCity(parts[0], hint);
  if (!city) return undefined;
  return {
    kind: 'city',
    value: cityValue(city),
    label: city.label,
    context: cityContext(city),
    country: city.country,
  };
}
