import { Map as MapLibreMap, setWorkerUrl, type MapOptions } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Minus, Plus } from '@phosphor-icons/react';
import React from 'react';
import type { CityFacet } from './vacancyFacets';
import {
  buildMapMarkers,
  cityBounds,
  focusBounds,
  formatCityDisplay,
  markerLabel,
  type MapNode,
} from './vacancyMapCluster';
import { buildVacancyMapStyle, type VacancyMapPalette } from './vacancyMapStyle';

// B553: воркер MapLibre — отдельный файл с нашего origin (CSP `worker-src 'self'`,
// в Tauri адрес относительно import.meta.url не строится).
setWorkerUrl(workerUrl);

export interface VacancyMapCanvasProps {
  readonly cities: readonly CityFacet[];
  readonly selectedCity?: string;
  readonly onSelectCity: (city?: string) => void;
  readonly onUnavailable: () => void;
}

const FIT_PADDING = 64;
const FIT_MAX_ZOOM = 6;
const WORLD_VIEW = { center: [40, 50] as [number, number], zoom: 2 };

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

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

/** На узком экране капсулы слипаются раньше: в кадре только основная половина выдачи. */
const NARROW_WIDTH = 600;
const NARROW_FOCUS_SHARE = 0.65;
/** Снизу на 390 — карточка «Показать список» и атрибуция: точки не должны уходить под них. */
const NARROW_PADDING = { top: 56, bottom: 168, left: 48, right: 64 };

function initialView(cities: readonly CityFacet[], width: number): Partial<MapOptions> {
  const narrow = width < NARROW_WIDTH;
  const bounds = narrow ? focusBounds(cities, NARROW_FOCUS_SHARE) : focusBounds(cities);
  if (!bounds) return WORLD_VIEW;
  return {
    bounds: bounds as MapOptions['bounds'],
    fitBoundsOptions: { padding: narrow ? NARROW_PADDING : FIT_PADDING, maxZoom: FIT_MAX_ZOOM },
  };
}

/**
 * Карта честно падает в «недоступна», если ни один тайл так и не загрузился
 * (офлайн, блокировка хоста, нет WebGL). Ошибка отдельного тайла после этого — не повод.
 */
function useMapLibre(
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
      instance = new MapLibreMap({
        container: element,
        style: buildVacancyMapStyle(readPalette(element)),
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        renderWorldCopies: false,
        ...initialView(citiesRef.current, element.clientWidth),
      });
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
    instance.on('move', () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => setFrame((value) => value + 1));
    });
    instance.touchZoomRotate.disableRotation();
    setMap(instance);
    return () => {
      cancelAnimationFrame(pending);
      instance.remove();
    };
  }, [container]);

  return { map, frame };
}

export default function VacancyMapCanvas({
  cities,
  selectedCity,
  onSelectCity,
  onUnavailable,
}: VacancyMapCanvasProps): React.JSX.Element {
  const container = React.useRef<HTMLDivElement>(null);
  const { map, frame } = useMapLibre(container, cities, onUnavailable);
  const nodes = React.useMemo(
    () =>
      map
        ? buildMapMarkers(cities, (point) => map.project([point.lng, point.lat]), selectedCity)
        : [],
    // frame пересчитывает капсулы при каждом сдвиге и зуме карты.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, frame, cities, selectedCity],
  );
  const animate = !prefersReducedMotion();

  const openCluster = (node: MapNode) => {
    const bounds = node.isCluster ? cityBounds(node.cities) : undefined;
    if (!map || !bounds) return;
    map.fitBounds(bounds as [[number, number], [number, number]], {
      padding: FIT_PADDING,
      maxZoom: Math.max(map.getZoom() + 2, FIT_MAX_ZOOM),
      animate,
    });
  };

  return (
    <>
      <div ref={container} className="career-map-gl" />
      <div className="career-map-markers">
        {nodes.map((node) => (
          <MapCapsuleButton
            key={node.id}
            node={node}
            active={!node.isCluster && node.city.city === selectedCity}
            onClick={() =>
              node.isCluster
                ? openCluster(node)
                : onSelectCity(selectedCity === node.city.city ? undefined : node.city.city)
            }
          />
        ))}
      </div>
      <MapZoomControls
        onZoomIn={() => map?.zoomIn({ animate })}
        onZoomOut={() => map?.zoomOut({ animate })}
      />
    </>
  );
}

function capsuleAccessibleName(node: MapNode): string {
  if (!node.isCluster) {
    return `Город ${formatCityDisplay(node.city.city, node.city.country).city}: ${node.count} вакансий`;
  }
  const names = node.cities
    .map((city) => `${formatCityDisplay(city.city, city.country).city} (${city.count})`)
    .join(', ');
  return `Кластер: ${node.totalCount} вакансий (${names}). Нажмите для приближения`;
}

/** B446-g4/B553: капсула «Москва 74» поверх карты; зона касания не меньше 44 px. */
function MapCapsuleButton({
  node,
  active,
  onClick,
}: {
  readonly node: MapNode;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  const count = node.isCluster ? node.totalCount : node.count;
  const tooltip = node.isCluster
    ? capsuleAccessibleName(node)
    : formatCityDisplay(node.city.city, node.city.country).tooltip;
  return (
    <button
      type="button"
      className={`career-map-marker${node.isCluster ? ' career-map-cluster-node' : ''}${active ? ' is-active' : ''}`}
      ref={(element) => {
        // Позиция меняется на каждом кадре движения карты; CSSOM, а не атрибут style (CSP).
        element?.style.setProperty(
          'transform',
          `translate(${Math.round(node.x)}px, ${Math.round(node.y)}px)`,
        );
      }}
      aria-label={capsuleAccessibleName(node)}
      aria-pressed={node.isCluster ? undefined : active}
      title={tooltip}
      onClick={onClick}
    >
      <span className="career-map-capsule">
        <span>{markerLabel(node)}</span>
        <span className="career-map-label-count">{count}</span>
      </span>
    </button>
  );
}

function MapZoomControls({
  onZoomIn,
  onZoomOut,
}: {
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
}) {
  return (
    <div className="career-map-zoom-controls" role="group" aria-label="Управление масштабом карты">
      <button
        type="button"
        className="career-map-zoom-btn"
        aria-label="Приблизить карту"
        onClick={onZoomIn}
      >
        <Plus size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="career-map-zoom-btn"
        aria-label="Отдалить карту"
        onClick={onZoomOut}
      >
        <Minus size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
