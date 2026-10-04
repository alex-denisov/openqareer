import type { MatchedVacancyItem, VacancyCompanyFeatures } from "../coach/cabinetTypes";
import { normalizeCityLabel } from "../../../shared/cityLabel";
import { isCountryName } from "../../../shared/placeNames";

export interface FacetMetric {
  readonly count: number;
  readonly total: number;
}

export interface MapFacetMetric extends FacetMetric {
  readonly unmappedCount: number;
  readonly missingCityCount: number;
  readonly unresolvedCityCount: number;
}

export interface CityFacet {
  readonly city: string;
  readonly country?: string;
  readonly coordinates?: { readonly lat: number; readonly lng: number };
  readonly count: number;
  readonly companyCount: number;
}

export interface VacancyFacetCounts {
  readonly total: number;
  readonly relocation: FacetMetric;
  readonly currencyRemote: FacetMetric;
  readonly russianAbroad: FacetMetric;
  readonly fullRemote: FacetMetric;
  readonly onMap: MapFacetMetric;
  readonly industries: ReadonlyArray<{ readonly name: string; readonly count: number }>;
  readonly cities: readonly CityFacet[];
}

export interface VacancyFacetFilters {
  readonly relocationOnly?: boolean;
  readonly currencyRemoteOnly?: boolean;
  readonly russianAbroadOnly?: boolean;
  readonly fullRemoteOnly?: boolean;
  readonly onMapOnly?: boolean;
  readonly industry?: string;
  readonly city?: string;
}

export function formatFacetDenominator(label: string, facet: FacetMetric): string {
  return `${label} (${facet.count} из ${facet.total})`;
}

function hasFullRemote(item: MatchedVacancyItem): boolean {
  return Boolean(item.cluster.isRemote || item.cluster.companyFeatures?.fullRemote);
}

function hasCoordinates(
  feat?: VacancyCompanyFeatures,
): feat is VacancyCompanyFeatures & { coordinates: { lat: number; lng: number } } {
  return Boolean(
    feat?.coordinates &&
      typeof feat.coordinates.lat === 'number' &&
      typeof feat.coordinates.lng === 'number',
  );
}

function vacancyCityName(item: MatchedVacancyItem): string | undefined {
  const featureCity = normalizeCityLabel(item.cluster.companyFeatures?.city);
  if (featureCity && !isCountryName(featureCity)) return featureCity;
  const locationCity = extractCityFromLocation(item.cluster.canonicalLocation);
  return locationCity && !isCountryName(locationCity) ? locationCity : undefined;
}

export function hasMapCityCoordinates(item: MatchedVacancyItem): boolean {
  return hasCoordinates(item.cluster.companyFeatures) && vacancyCityName(item) !== undefined;
}

function countMetrics(items: readonly MatchedVacancyItem[]) {
  let relocation = 0;
  let currencyRemote = 0;
  let russianAbroad = 0;
  let fullRemote = 0;
  let onMap = 0;
  let missingCityCount = 0;
  let unresolvedCityCount = 0;

  for (const item of items) {
    const feat = item.cluster.companyFeatures;
    if (feat?.relocation) relocation += 1;
    if (feat?.currencyRemote) currencyRemote += 1;
    if (feat?.russianAbroad) russianAbroad += 1;
    if (hasFullRemote(item)) fullRemote += 1;
    const city = vacancyCityName(item);
    if (!city) {
      missingCityCount += 1;
    } else if (hasCoordinates(feat)) {
      onMap += 1;
    } else {
      unresolvedCityCount += 1;
    }
  }

  return { relocation, currencyRemote, russianAbroad, fullRemote, onMap, missingCityCount, unresolvedCityCount };
}

function aggregateIndustries(items: readonly MatchedVacancyItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const ind = item.cluster.companyFeatures?.industry?.trim();
    if (ind) {
      counts.set(ind, (counts.get(ind) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru-RU'));
}

/**
 * Ключ хаба — точка на карте, а не написание названия. «Лиссабон» и «Lisbon»
 * приходят с одними координатами из общего справочника, и до этого стояли на
 * карте двумя хабами: один город был посчитан дважды (прод 2026-09-06).
 */
function hubKey(coordinates: { lat: number; lng: number }): string {
  return `${coordinates.lat.toFixed(3)},${coordinates.lng.toFixed(3)}`;
}

const CYRILLIC = /\p{Script=Cyrillic}/u;

/**
 * Каким из наблюдённых написаний называть сведённый хаб. Продукт говорит
 * по-русски, поэтому русское имя выигрывает; иначе — первое наблюдённое, чтобы
 * подпись не прыгала от состава пула.
 */
function preferredCityName(current: string, candidate: string): string {
  if (CYRILLIC.test(current)) return current;
  return CYRILLIC.test(candidate) ? candidate : current;
}

function aggregateCities(items: readonly MatchedVacancyItem[]) {
  const map = new Map<
    string,
    {
      city: string;
      country?: string;
      coordinates: { lat: number; lng: number };
      count: number;
      companies: Set<string>;
    }
  >();

  for (const item of items) {
    const feat = item.cluster.companyFeatures;
    if (!hasCoordinates(feat)) continue;
    const city = vacancyCityName(item);
    // Страна — не городской хаб: «USA 12» в списке городов раздувает счёт и
    // обещает точку там, где её нет (B203, прод 2026-09-06).
    if (!city) continue;

    const key = hubKey(feat.coordinates);
    const existing = map.get(key) ?? {
      city,
      country: feat.country,
      coordinates: feat.coordinates,
      count: 0,
      companies: new Set<string>(),
    };
    existing.city = preferredCityName(existing.city, city);
    existing.count += 1;
    if (item.cluster.canonicalCompany) existing.companies.add(item.cluster.canonicalCompany);
    map.set(key, existing);
  }

  return Array.from(map.values())
    .map((c) => ({
      city: c.city,
      country: c.country,
      coordinates: c.coordinates,
      count: c.count,
      companyCount: c.companies.size,
    }))
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city, "ru-RU"));
}

function extractCityFromLocation(location?: string): string | undefined {
  if (!location) return undefined;
  const parts = location.split(",").map((s) => s.trim());
  return normalizeCityLabel(parts[0]);
}

export function calculateVacancyFacets(items: readonly MatchedVacancyItem[]): VacancyFacetCounts {
  const total = items.length;
  const metrics = countMetrics(items);

  return {
    total,
    relocation: { count: metrics.relocation, total },
    currencyRemote: { count: metrics.currencyRemote, total },
    russianAbroad: { count: metrics.russianAbroad, total },
    fullRemote: { count: metrics.fullRemote, total },
    onMap: {
      count: metrics.onMap,
      total,
      unmappedCount: total - metrics.onMap,
      missingCityCount: metrics.missingCityCount,
      unresolvedCityCount: metrics.unresolvedCityCount,
    },
    industries: aggregateIndustries(items),
    cities: aggregateCities(items),
  };
}

function matchesIndustry(feat: VacancyCompanyFeatures | undefined, target: string): boolean {
  return feat?.industry?.toLowerCase().trim() === target.toLowerCase().trim();
}

function coordinateHubKey(point: { readonly lat: number; readonly lng: number }): string {
  return `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`;
}

function selectedCityCoordinates(
  items: readonly MatchedVacancyItem[],
  target: string,
): { readonly lat: number; readonly lng: number } | undefined {
  const targetName = normalizeCityLabel(target)?.toLocaleLowerCase('ru-RU');
  if (!targetName) return undefined;
  return items.find((item) => {
    const city = vacancyCityName(item)?.toLocaleLowerCase('ru-RU');
    return city === targetName && hasCoordinates(item.cluster.companyFeatures);
  })?.cluster.companyFeatures?.coordinates;
}

function matchesCity(
  item: MatchedVacancyItem,
  target: string,
  targetCoordinates?: { readonly lat: number; readonly lng: number },
): boolean {
  const feat = item.cluster.companyFeatures;
  if (
    targetCoordinates &&
    hasCoordinates(feat) &&
    coordinateHubKey(feat.coordinates) === coordinateHubKey(targetCoordinates)
  ) {
    return true;
  }
  const targetName = normalizeCityLabel(target)?.toLocaleLowerCase('ru-RU');
  const city = vacancyCityName(item)?.toLocaleLowerCase('ru-RU');
  if (city && targetName && city === targetName) return true;
  const q = target.toLocaleLowerCase('ru-RU').trim();
  return Boolean(item.cluster.canonicalLocation?.toLowerCase().includes(q));
}

export function matchesVacancyCity(
  item: MatchedVacancyItem,
  target: string,
  items: readonly MatchedVacancyItem[],
): boolean {
  return matchesCity(item, target, selectedCityCoordinates(items, target));
}

export function filterVacanciesByFacets(
  items: readonly MatchedVacancyItem[],
  filters: VacancyFacetFilters,
): MatchedVacancyItem[] {
  const selectedCoordinates = filters.city ? selectedCityCoordinates(items, filters.city) : undefined;
  return items.filter((item) => {
    const feat = item.cluster.companyFeatures;
    if (filters.relocationOnly && !feat?.relocation) return false;
    if (filters.currencyRemoteOnly && !feat?.currencyRemote) return false;
    if (filters.russianAbroadOnly && !feat?.russianAbroad) return false;
    if (filters.fullRemoteOnly && !hasFullRemote(item)) return false;
    if (filters.onMapOnly && !hasMapCityCoordinates(item)) return false;
    if (filters.industry && !matchesIndustry(feat, filters.industry)) return false;
    if (filters.city && !matchesCity(item, filters.city, selectedCoordinates)) return false;
    return true;
  });
}
