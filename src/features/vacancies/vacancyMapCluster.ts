import type { CityFacet } from './vacancyFacets';

export interface MapClusterNode {
  readonly id: string;
  readonly isCluster: true;
  readonly x: number;
  readonly y: number;
  readonly totalCount: number;
  readonly cities: readonly CityFacet[];
  readonly label: string;
}

export interface MapCityNode {
  readonly id: string;
  readonly isCluster: false;
  readonly x: number;
  readonly y: number;
  readonly count: number;
  readonly city: CityFacet;
  readonly showLabel: boolean;
}

export type MapNode = MapClusterNode | MapCityNode;

export interface CityDisplayInfo {
  readonly city: string;
  readonly country?: string;
  readonly tooltip: string;
}

const COUNTRY_CODE_TO_RU: Readonly<Record<string, string>> = {
  AU: 'Австралия',
  US: 'США',
  UK: 'Великобритания',
  GB: 'Великобритания',
  DE: 'Германия',
  NL: 'Нидерланды',
  RU: 'Россия',
  KZ: 'Казахстан',
  AM: 'Армения',
  GE: 'Грузия',
  CY: 'Кипр',
  AE: 'ОАЭ',
  ES: 'Испания',
  PT: 'Португалия',
  FR: 'Франция',
  PL: 'Польша',
  RS: 'Сербия',
};

const COUNTRY_NAME_TO_RU: Readonly<Record<string, string>> = {
  australia: 'Австралия',
  netherlands: 'Нидерланды',
  germany: 'Германия',
  russia: 'Россия',
  spain: 'Испания',
  portugal: 'Португалия',
  france: 'Франция',
  poland: 'Польша',
  uk: 'Великобритания',
  usa: 'США',
};

const KNOWN_CITY_RU: Readonly<Record<string, string>> = {
  sydney: 'Сидней',
};

/**
 * Нормализует отображение города: убирает префикс страны «AU: »,
 * переводит известные города и формирует подсказку со страной.
 */
export function formatCityDisplay(rawCity: string, rawCountry?: string): CityDisplayInfo {
  let city = rawCity.trim();
  let country = rawCountry?.trim();

  const prefixMatch = city.match(/^([A-Za-z]{2,3}):\s*(.+)$/u);
  if (prefixMatch) {
    const code = prefixMatch[1].toUpperCase();
    city = prefixMatch[2].trim();
    if (!country && COUNTRY_CODE_TO_RU[code]) {
      country = COUNTRY_CODE_TO_RU[code];
    }
  }

  const cityKey = city.toLowerCase();
  if (KNOWN_CITY_RU[cityKey]) {
    city = KNOWN_CITY_RU[cityKey];
  }

  if (country) {
    const countryKey = country.toLowerCase();
    if (COUNTRY_NAME_TO_RU[countryKey]) {
      country = COUNTRY_NAME_TO_RU[countryKey];
    }
  }

  const tooltip = country ?? city;
  return { city, country, tooltip };
}

/**
 * Очищает canonicalLocation вакансии от префикса страны вроде «AU: Sydney»
 * и заменяет латинские названия ключевых городов на русские.
 */
export function formatLocationDisplay(location?: string): string | undefined {
  if (!location) return undefined;
  return location
    .replace(/\b([A-Za-z]{2,3}):\s*/gu, '')
    .replace(/\bSydney\b/gu, 'Сидней');
}

export function projectCoords(lat: number, lng: number): { x: number; y: number } {
  const minLat = -60;
  const maxLat = 85;
  const clampedLat = Math.max(minLat, Math.min(maxLat, lat));
  const x = Math.round(((lng + 180) / 360) * 900);
  const y = Math.round(((maxLat - clampedLat) / (maxLat - minLat)) * 480);
  return { x, y };
}

const LABEL_HALF_WIDTH = 46;
const LABEL_HEIGHT = 16;
const BASE_GRID_SIZE = 48;

function groupIntoBuckets(
  cities: readonly CityFacet[],
  gridSize: number,
): Map<string, { city: CityFacet; x: number; y: number }[]> {
  const buckets = new Map<string, { city: CityFacet; x: number; y: number }[]>();
  for (const city of cities) {
    if (!city.coordinates) continue;
    const { x, y } = projectCoords(city.coordinates.lat, city.coordinates.lng);
    const key = `${Math.floor(x / gridSize)}:${Math.floor(y / gridSize)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push({ city, x, y });
    buckets.set(key, bucket);
  }
  return buckets;
}

function createNodesFromBuckets(
  buckets: Map<string, { city: CityFacet; x: number; y: number }[]>,
  zoom: number,
): { nodes: MapNode[]; occupiedSpots: { x: number; y: number }[] } {
  const nodes: MapNode[] = [];
  const occupiedSpots: { x: number; y: number }[] = [];

  for (const [key, items] of buckets.entries()) {
    if (items.length === 1 || zoom >= 3) {
      for (const item of items) {
        nodes.push({
          id: `city-${item.city.city}`,
          isCluster: false,
          x: item.x,
          y: item.y,
          count: item.city.count,
          city: item.city,
          showLabel: false,
        });
      }
    } else {
      const totalCount = items.reduce((sum, i) => sum + i.city.count, 0);
      const avgX = Math.round(items.reduce((sum, i) => sum + i.x * i.city.count, 0) / totalCount);
      const avgY = Math.round(items.reduce((sum, i) => sum + i.y * i.city.count, 0) / totalCount);

      nodes.push({
        id: `cluster-${key}`,
        isCluster: true,
        x: avgX,
        y: avgY,
        totalCount,
        cities: items.map((i) => i.city),
        label: `${totalCount}`,
      });
      occupiedSpots.push({ x: avgX, y: avgY });
    }
  }

  return { nodes, occupiedSpots };
}

function resolveLabels(
  nodes: readonly MapNode[],
  occupiedSpots: { x: number; y: number }[],
  selectedCity?: string,
): readonly MapNode[] {
  const cityNodes = nodes.filter((n): n is MapCityNode => !n.isCluster);
  const sortedCities = [...cityNodes].sort((a, b) => {
    if (a.city.city === selectedCity) return -1;
    if (b.city.city === selectedCity) return 1;
    return b.count - a.count;
  });

  const cityVisibility = new Map<string, boolean>();
  for (const node of sortedCities) {
    const collides = occupiedSpots.some(
      (spot) =>
        Math.abs(spot.x - node.x) < LABEL_HALF_WIDTH &&
        Math.abs(spot.y - node.y) < LABEL_HEIGHT,
    );
    const showLabel = node.city.city === selectedCity || !collides;
    cityVisibility.set(node.id, showLabel);
    if (showLabel) {
      occupiedSpots.push({ x: node.x, y: node.y });
    }
  }

  return nodes.map((node) => {
    if (node.isCluster) return node;
    return { ...node, showLabel: Boolean(cityVisibility.get(node.id)) };
  });
}

/**
 * Кластеризует города по сетке в зависимости от уровня зума (1..3).
 * Исключает наложение подписей друг на друга.
 */
export function clusterCitiesByGrid(
  cities: readonly CityFacet[],
  zoom = 1,
  selectedCity?: string,
): readonly MapNode[] {
  const validCities = cities.filter((c) => c.coordinates !== undefined);
  if (validCities.length === 0) return [];

  const gridSize = BASE_GRID_SIZE / Math.max(1, zoom);
  const buckets = groupIntoBuckets(validCities, gridSize);
  const { nodes, occupiedSpots } = createNodesFromBuckets(buckets, zoom);
  return resolveLabels(nodes, occupiedSpots, selectedCity);
}
