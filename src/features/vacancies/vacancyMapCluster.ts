import type { CityFacet } from './vacancyFacets';

export interface MapClusterNode {
  readonly id: string;
  readonly isCluster: true;
  readonly x: number;
  readonly y: number;
  readonly totalCount: number;
  readonly cities: readonly CityFacet[];
}

export interface MapCityNode {
  readonly id: string;
  readonly isCluster: false;
  readonly x: number;
  readonly y: number;
  readonly count: number;
  readonly city: CityFacet;
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
  return location.replace(/\b([A-Za-z]{2,3}):\s*/gu, '').replace(/\bSydney\b/gu, 'Сидней');
}

export type ScreenProjector = (point: { readonly lat: number; readonly lng: number }) => {
  readonly x: number;
  readonly y: number;
};

/** Границы [[west, south], [east, north]] — карта открывается приближенной к выдаче. */
export type MapBounds = readonly [readonly [number, number], readonly [number, number]];

const CAPSULE_CHAR_WIDTH = 7.4;
const CAPSULE_PADDING = 20;
const CAPSULE_MIN_WIDTH = 44;
const CAPSULE_HEIGHT = 28;
const CAPSULE_GAP = 4;

/** Ширина капсулы «Москва 74» на экране: шрифт 13 px, поля по 10 px, не уже зоны касания. */
export function capsuleWidth(text: string): number {
  return Math.max(CAPSULE_MIN_WIDTH, text.length * CAPSULE_CHAR_WIDTH + CAPSULE_PADDING);
}

/** Кластер называет самый крупный город и сколько ещё рядом: «Москва +2». */
export function markerLabel(node: MapNode): string {
  if (!node.isCluster) return formatCityDisplay(node.city.city, node.city.country).city;
  const top = [...node.cities].sort((a, b) => b.count - a.count)[0];
  const name = top ? formatCityDisplay(top.city, top.country).city : 'Города';
  return node.cities.length > 1 ? `${name} +${node.cities.length - 1}` : name;
}

function nodeCount(node: MapNode): number {
  return node.isCluster ? node.totalCount : node.count;
}

function nodeCities(node: MapNode): readonly CityFacet[] {
  return node.isCluster ? node.cities : [node.city];
}

function nodeWidth(node: MapNode): number {
  return capsuleWidth(`${markerLabel(node)} ${nodeCount(node)}`);
}

function overlaps(a: MapNode, b: MapNode): boolean {
  const halfWidths = (nodeWidth(a) + nodeWidth(b)) / 2 + CAPSULE_GAP;
  return Math.abs(a.x - b.x) < halfWidths && Math.abs(a.y - b.y) < CAPSULE_HEIGHT + CAPSULE_GAP;
}

function mergedNode(into: MapNode, other: MapNode): MapClusterNode {
  return {
    id: `cluster-${into.id}`,
    isCluster: true,
    x: into.x,
    y: into.y,
    totalCount: nodeCount(into) + nodeCount(other),
    cities: [...nodeCities(into), ...nodeCities(other)],
  };
}

/**
 * B553: капсулы городов в пикселях экрана карты. Капсула, наехавшая бы на уже
 * поставленную, сливается в неё (крупнейшие ставятся первыми); выбранный город
 * не сливается. При приближении расстояния растут, и кластеры распадаются.
 */
export function buildMapMarkers(
  cities: readonly CityFacet[],
  project: ScreenProjector,
  selectedCity?: string,
): readonly MapNode[] {
  const isSelected = (city: CityFacet) => city.city === selectedCity;
  const ordered = cities
    .filter((city) => city.coordinates !== undefined)
    .sort((a, b) => Number(isSelected(b)) - Number(isSelected(a)) || b.count - a.count);
  const accepted: MapNode[] = [];
  for (const city of ordered) {
    const { x, y } = project(city.coordinates!);
    const node: MapCityNode = {
      id: `city-${city.city}`,
      isCluster: false,
      x,
      y,
      count: city.count,
      city,
    };
    const index = isSelected(city)
      ? -1
      : accepted.findIndex(
          (other) => !(!other.isCluster && isSelected(other.city)) && overlaps(other, node),
        );
    if (index < 0) accepted.push(node);
    else accepted[index] = mergedNode(accepted[index]!, node);
  }
  return accepted;
}

export function cityBounds(cities: readonly CityFacet[]): MapBounds | undefined {
  const points = cities.flatMap((city) => (city.coordinates ? [city.coordinates] : []));
  if (!points.length) return undefined;
  const lngs = points.map((point) => point.lng);
  const lats = points.map((point) => point.lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}
