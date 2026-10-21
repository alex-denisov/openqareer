import { AttributionControl, Map as MapLibreMap, setWorkerUrl, type MapOptions } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import React from 'react';
import type { CityFacet } from './vacancyFacets';
import { focusBounds } from './vacancyMapCluster';
import { buildVacancyMapStyle, type VacancyMapPalette } from './vacancyMapStyle';

// B553: воркер MapLibre — отдельный файл с нашего origin (CSP `worker-src 'self'`,
// в Tauri адрес относительно import.meta.url не строится).
setWorkerUrl(workerUrl);

const FIT_MAX_ZOOM = 6;
const WORLD_VIEW = { center: [40, 50] as [number, number], zoom: 2 };
const NARROW_WIDTH = 600;
/** Отступы подгонки: по бокам — половина широкой капсулы и ±; снизу — заметка (1440) или карточка города (390). */
const WIDE_PADDING = { top: 56, bottom: 96, left: 96, right: 112 };
const NARROW_PADDING = { top: 56, bottom: 128, left: 80, right: 80 };

/** MapLibre не понимает oklch: токен рисуется в пиксель холста и читается обратно как rgba. */
function tokenColor(element: HTMLElement, token: string, fallback: string): string {
  const value = getComputedStyle(element).getPropertyValue(token).trim();
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!value || !context) return fallback;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${((a ?? 255) / 255).toFixed(2)})`;
}

function readPalette(element: HTMLElement): VacancyMapPalette {
  return {
    land: tokenColor(element, '--career-surface', '#1b2029'),
    water: tokenColor(element, '--career-bg', '#0d1016'),
    line: tokenColor(element, '--career-line-strong', '#3a3f48'),
    label: tokenColor(element, '--career-text-soft', '#aab0bb'),
    halo: tokenColor(element, '--career-bg', '#0d1016'),
  };
}

function initialView(cities: readonly CityFacet[], width: number): Partial<MapOptions> {
  const bounds = focusBounds(cities);
  if (!bounds) return WORLD_VIEW;
  return {
    bounds: bounds as MapOptions['bounds'],
    fitBoundsOptions: {
      padding: width < NARROW_WIDTH ? NARROW_PADDING : WIDE_PADDING,
      maxZoom: FIT_MAX_ZOOM,
    },
  };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function createMap(element: HTMLDivElement, cities: readonly CityFacet[]): MapLibreMap {
  const map = new MapLibreMap({
    container: element,
    style: buildVacancyMapStyle(readPalette(element)),
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    renderWorldCopies: false,
    ...initialView(cities, element.clientWidth),
  });
  // Атрибуция — компактная кнопка «i», раскрывается по нажатию.
  map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
  map.once('load', () =>
    element.querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show'),
  );
  map.touchZoomRotate.disableRotation();
  return map;
}

/**
 * Карта честно падает в «недоступна», если ни один тайл так и не загрузился
 * (офлайн, блокировка хоста, нет WebGL). Ошибка отдельного тайла после этого — не повод.
 */
export function useVacancyMapLibre(
  container: React.RefObject<HTMLDivElement | null>,
  cities: readonly CityFacet[],
  onUnavailable: () => void,
): { readonly map: MapLibreMap | undefined; readonly frame: number } {
  const [map, setMap] = React.useState<MapLibreMap>();
  const [frame, setFrame] = React.useState(0);
  const failRef = React.useRef(onUnavailable);
  failRef.current = onUnavailable;
  const citiesRef = React.useRef(cities);

  React.useEffect(() => {
    const element = container.current;
    if (!element) return undefined;
    let instance: MapLibreMap;
    try {
      instance = createMap(element, citiesRef.current);
    } catch {
      failRef.current();
      return undefined;
    }
    let tileLoaded = false;
    let pending = 0;
    instance.on('data', (event) => {
      if (event.dataType === 'source' && 'tile' in event && event.tile) tileLoaded = true;
    });
    instance.on('error', () => {
      if (!tileLoaded) failRef.current();
    });
    instance.on('render', () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => setFrame((value) => value + 1));
    });
    setMap(instance);
    return () => {
      cancelAnimationFrame(pending);
      instance.remove();
    };
  }, [container]);

  return { map, frame };
}
