import type { MatchedVacancyItem, VacancyCompanyFeatures } from "../coach/cabinetTypes";
import { normalizeCityLabel } from "../../../shared/cityLabel";

export interface FacetMetric {
  readonly count: number;
  readonly total: number;
}

export interface MapFacetMetric extends FacetMetric {
  readonly unmappedCount: number;
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

function countMetrics(items: readonly MatchedVacancyItem[]) {
  let relocation = 0;
  let currencyRemote = 0;
  let russianAbroad = 0;
  let fullRemote = 0;
  let onMap = 0;

  for (const item of items) {
    const feat = item.cluster.companyFeatures;
    if (feat?.relocation) relocation += 1;
    if (feat?.currencyRemote) currencyRemote += 1;
    if (feat?.russianAbroad) russianAbroad += 1;
    if (hasFullRemote(item)) fullRemote += 1;
    if (hasCoordinates(feat)) onMap += 1;
  }

  return { relocation, currencyRemote, russianAbroad, fullRemote, onMap };
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
    const city =
      normalizeCityLabel(feat.city) ?? extractCityFromLocation(item.cluster.canonicalLocation);
    if (!city) continue;

    const existing = map.get(city) ?? {
      city,
      country: feat.country,
      coordinates: feat.coordinates,
      count: 0,
      companies: new Set<string>(),
    };
    existing.count += 1;
    if (item.cluster.canonicalCompany) existing.companies.add(item.cluster.canonicalCompany);
    map.set(city, existing);
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
    onMap: { count: metrics.onMap, total, unmappedCount: total - metrics.onMap },
    industries: aggregateIndustries(items),
    cities: aggregateCities(items),
  };
}

function matchesIndustry(feat: VacancyCompanyFeatures | undefined, target: string): boolean {
  return feat?.industry?.toLowerCase().trim() === target.toLowerCase().trim();
}

function matchesCity(item: MatchedVacancyItem, target: string): boolean {
  const feat = item.cluster.companyFeatures;
  const q = target.toLowerCase().trim();
  if (feat?.city?.toLowerCase().trim() === q) return true;
  return Boolean(item.cluster.canonicalLocation?.toLowerCase().includes(q));
}

export function filterVacanciesByFacets(
  items: readonly MatchedVacancyItem[],
  filters: VacancyFacetFilters,
): MatchedVacancyItem[] {
  return items.filter((item) => {
    const feat = item.cluster.companyFeatures;
    if (filters.relocationOnly && !feat?.relocation) return false;
    if (filters.currencyRemoteOnly && !feat?.currencyRemote) return false;
    if (filters.russianAbroadOnly && !feat?.russianAbroad) return false;
    if (filters.fullRemoteOnly && !hasFullRemote(item)) return false;
    if (filters.onMapOnly && !hasCoordinates(feat)) return false;
    if (filters.industry && !matchesIndustry(feat, filters.industry)) return false;
    if (filters.city && !matchesCity(item, filters.city)) return false;
    return true;
  });
}
