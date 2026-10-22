import type { StyleSpecification } from 'maplibre-gl';

/**
 * B553: векторные тайлы OpenFreeMap — без ключа и лимитов, коммерческое
 * использование разрешено (https://openfreemap.org/, раздел FAQ), атрибуция
 * OpenFreeMap / OpenMapTiles / OpenStreetMap обязательна.
 */
export const MAP_TILE_HOST = 'https://tiles.openfreemap.org';

export const OSM_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

/** Цвета карты из токенов `--career-*`, уже переведённые в rgb (MapLibre не читает oklch). */
export interface VacancyMapPalette {
  readonly land: string;
  readonly water: string;
  readonly line: string;
  readonly label: string;
  readonly halo: string;
}

const LABEL_FONT = ['Noto Sans Regular'];
const LOCAL_NAME = ['coalesce', ['get', 'name:ru'], ['get', 'name']];

function placeLabel(
  palette: VacancyMapPalette,
  id: string,
  filter: unknown[],
  minzoom: number,
  size: number,
  opacity: number,
) {
  return {
    id,
    type: 'symbol' as const,
    source: 'openmaptiles',
    'source-layer': 'place',
    minzoom,
    filter,
    layout: { 'text-field': LOCAL_NAME, 'text-font': LABEL_FONT, 'text-size': size },
    paint: {
      'text-color': palette.label,
      'text-halo-color': palette.halo,
      'text-halo-width': 1,
      'text-opacity': opacity,
    },
  };
}

/** Приглушённый тёмный стиль: суша и вода тоном, границы и крупные дороги линией, подписи мягким текстом. */
export function buildVacancyMapStyle(palette: VacancyMapPalette): StyleSpecification {
  return {
    version: 8,
    glyphs: `${MAP_TILE_HOST}/fonts/{fontstack}/{range}.pbf`,
    sources: {
      openmaptiles: {
        type: 'vector',
        url: `${MAP_TILE_HOST}/planet`,
        attribution: OSM_ATTRIBUTION,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': palette.land } },
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        paint: { 'fill-color': palette.water },
      },
      {
        id: 'roads',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 6,
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
        paint: { 'line-color': palette.line, 'line-width': 0.6, 'line-opacity': 0.5 },
      },
      {
        id: 'boundaries',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'boundary',
        filter: ['all', ['<=', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': palette.line, 'line-width': 0.6, 'line-opacity': 0.6 },
      },
      // B553: карта — фон. Страны тусклее и мельче; города подложки только при сильном
      // приближении — на старте их заменяют капсулы выдачи.
      placeLabel(palette, 'country-label', ['==', ['get', 'class'], 'country'], 1, 10, 0.55),
      placeLabel(
        palette,
        'place-label',
        ['in', ['get', 'class'], ['literal', ['city', 'town']]],
        8,
        11,
        0.7,
      ),
    ],
  } as StyleSpecification;
}
