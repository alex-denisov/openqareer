import type { Map as MapLibreMap } from 'maplibre-gl';
import React from 'react';
import { pluralRu } from '../../../shared/pluralRu';
import type { CityFacet } from './vacancyFacets';
import {
  buildMapMarkers,
  cityBounds,
  clampMarker,
  formatCityDisplay,
  markerLabel,
  type MapNode,
} from './vacancyMapCluster';
import { MapCapsuleButton, MapZoomControls } from './VacancyMapControls';
import { prefersReducedMotion, useVacancyMapLibre } from './useVacancyMapLibre';
import { vacancyMapFitPadding } from './vacancyMapPadding';

export interface VacancyMapCanvasProps {
  readonly cities: readonly CityFacet[];
  readonly selectedCity?: string;
  readonly onSelectCity: (city?: string) => void;
  /** 390: «Показать список» — список по всем городам капсулы. */
  readonly onShowCities: (cities: readonly string[]) => void;
  readonly onUnavailable: () => void;
  /** 390: капсула выбирает город в карточке внизу, а не сразу открывает список. */
  readonly compact?: boolean;
}

const FIT_PADDING = 96;
const FIT_MAX_ZOOM = 6;

function nodeCount(node: MapNode): number {
  return node.isCluster ? node.totalCount : node.count;
}

function nodeCityNames(node: MapNode): readonly string[] {
  return node.isCluster ? node.cities.map((city) => city.city) : [node.city.city];
}

function nodeHasCity(node: MapNode, city: string | undefined): boolean {
  return node.isCluster ? node.cities.some((item) => item.city === city) : node.city.city === city;
}

interface PlacedNode {
  readonly node: MapNode;
  readonly x: number;
  readonly y: number;
}

function placeNodes(map: MapLibreMap | undefined, cities: readonly CityFacet[], selected?: string) {
  if (!map) return [];
  const canvas = map.getCanvas();
  const view = { width: canvas.clientWidth, height: canvas.clientHeight };
  return buildMapMarkers(cities, (point) => map.project([point.lng, point.lat]), selected).flatMap(
    (node): PlacedNode[] => {
      const place = clampMarker(node, `${markerLabel(node)} ${nodeCount(node)}`, view);
      return place ? [{ node, ...place }] : [];
    },
  );
}

function useMapActions(
  map: MapLibreMap | undefined,
  options: {
    readonly compact: boolean;
    readonly selectedCity?: string;
    readonly onSelectCity: (city?: string) => void;
    readonly onCardCity: (city: string) => void;
  },
) {
  const animate = !prefersReducedMotion();
  const zoomTo = (node: MapNode) => {
    const bounds = cityBounds(node.isCluster ? node.cities : [node.city]);
    if (!map || !bounds) return;
    map.fitBounds(bounds as [[number, number], [number, number]], {
      // 390: те же отступы, что при открытии — капсулы не уходят под ± и карточку.
      padding: options.compact
        ? { ...vacancyMapFitPadding(map.getContainer().clientWidth) }
        : FIT_PADDING,
      maxZoom: Math.max(map.getZoom() + 2, FIT_MAX_ZOOM),
      animate,
    });
  };
  // Кластер приближается; на 390 город выбирается в карточку, на 1440 — сразу в список.
  const choose = (node: MapNode) => {
    if (node.isCluster) return zoomTo(node);
    if (options.compact) return options.onCardCity(node.city.city);
    const city = node.city.city;
    return options.onSelectCity(options.selectedCity === city ? undefined : city);
  };
  return { animate, zoomTo, choose };
}

export default function VacancyMapCanvas({
  cities,
  selectedCity,
  onSelectCity,
  onShowCities,
  onUnavailable,
  compact = false,
}: VacancyMapCanvasProps): React.JSX.Element {
  const container = React.useRef<HTMLDivElement>(null);
  const { map, frame } = useVacancyMapLibre(container, cities, onUnavailable);
  const [cardCity, setCardCity] = React.useState(selectedCity);
  const placed = React.useMemo(
    () => placeNodes(map, cities, selectedCity),
    // frame пересчитывает капсулы при каждом кадре движения и зума карты.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, frame, cities, selectedCity],
  );
  const { animate, choose } = useMapActions(map, {
    compact,
    selectedCity,
    onSelectCity,
    onCardCity: setCardCity,
  });
  const cardNode =
    placed.find((item) => nodeHasCity(item.node, cardCity))?.node ??
    [...placed].sort((a, b) => nodeCount(b.node) - nodeCount(a.node))[0]?.node;

  return (
    <>
      <div ref={container} className="career-map-gl" />
      <MapMarkers
        placed={placed}
        activeCity={compact ? cardCity : selectedCity}
        onChoose={choose}
      />
      <MapZoomControls
        onZoomIn={() => map?.zoomIn({ animate })}
        onZoomOut={() => map?.zoomOut({ animate })}
      />
      {compact && cardNode ? (
        <MapCityCard node={cardNode} onShowList={() => onShowCities(nodeCityNames(cardNode))} />
      ) : null}
    </>
  );
}

function MapMarkers({
  placed,
  activeCity,
  onChoose,
}: {
  readonly placed: readonly PlacedNode[];
  readonly activeCity?: string;
  readonly onChoose: (node: MapNode) => void;
}) {
  return (
    <div className="career-map-markers">
      {placed.map(({ node, x, y }) => (
        <MapCapsuleButton
          key={node.id}
          node={node}
          x={x}
          y={y}
          count={nodeCount(node)}
          active={!node.isCluster && nodeHasCity(node, activeCity)}
          onClick={() => onChoose(node)}
        />
      ))}
    </div>
  );
}

/**
 * B553: на 390 внизу карты — город из капсулы с тем же числом (макет 390m).
 * У кластера список открывается по всем его городам — в нём ровно это число строк.
 */
function MapCityCard({
  node,
  onShowList,
}: {
  readonly node: MapNode;
  readonly onShowList: () => void;
}) {
  const name = node.isCluster
    ? `${markerLabel(node)} и рядом`
    : formatCityDisplay(node.city.city, node.city.country).city;
  return (
    <div className="career-map-city-card">
      <div>
        <strong>{name}</strong>
        <small>{pluralRu(nodeCount(node), ['вакансия', 'вакансии', 'вакансий'])} на карте</small>
      </div>
      <button type="button" className="career-map-city-card-cta" onClick={onShowList}>
        Показать список
      </button>
    </div>
  );
}
