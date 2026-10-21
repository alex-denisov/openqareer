import { Info } from '@phosphor-icons/react';
import React from 'react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import {
  calculateVacancyFacets,
  hasMapCityCoordinates,
  vacancyCityName,
  type CityFacet,
} from './vacancyFacets';
import { NATURAL_EARTH_COUNTRY_CONTOURS } from './naturalEarth110m';
import { vacancyMapNote, type VacancyMapNoteCounts } from './vacancyMapNote';
import {
  clusterCitiesByGrid,
  formatCityDisplay,
  fitMapView,
  projectCoords,
  type MapClusterNode as ClusterNodeType,
} from './vacancyMapCluster';

interface VacancyMapViewProps {
  readonly items: readonly MatchedVacancyItem[];
  readonly selectedCity?: string;
  readonly onSelectCity: (city?: string) => void;
  /** Вся выдача с условиями (сервер); без неё заметка считает загруженное. */
  readonly total?: number;
}

export function VacancyMapView({
  items,
  selectedCity,
  onSelectCity,
  total,
}: VacancyMapViewProps): React.JSX.Element {
  const facets = calculateVacancyFacets(items);
  const [initial] = React.useState(() =>
    fitMapView(
      facets.cities.flatMap((city) =>
        city.coordinates ? [projectCoords(city.coordinates.lat, city.coordinates.lng)] : [],
      ),
    ),
  );
  const [zoom, setZoom] = React.useState<number>(initial.zoom);
  const [center, setCenter] = React.useState<{ x: number; y: number }>(initial.center);

  return (
    <div className="career-vacancy-map-view vacancy-map-view">
      <div className="career-map-canvas-container">
        <MapSvg
          cities={facets.cities}
          selectedCity={selectedCity}
          onSelectCity={onSelectCity}
          zoom={zoom}
          center={center}
          onZoomChange={(newZoom, newCenter) => {
            setZoom(newZoom);
            if (newCenter) setCenter(newCenter);
          }}
        />
        <MapZoomControls
          zoom={zoom}
          onZoomChange={(newZoom) => setZoom(newZoom)}
          onResetZoom={() => {
            setZoom(1);
            setCenter({ x: 450, y: 240 });
          }}
        />
        <MapHeader items={items} total={total ?? items.length} />
      </div>
    </div>
  );
}

function MapZoomControls({
  zoom,
  onZoomChange,
  onResetZoom,
}: {
  zoom: number;
  onZoomChange: (newZoom: number) => void;
  onResetZoom: () => void;
}) {
  return (
    <div className="career-map-zoom-controls" role="group" aria-label="Управление масштабом карты">
      <button
        type="button"
        className="career-chip career-map-zoom-btn"
        aria-label="Приблизить карту"
        disabled={zoom >= 3}
        onClick={() => onZoomChange(Math.min(3, zoom + 1))}
      >
        +
      </button>
      <button
        type="button"
        className="career-chip career-map-zoom-btn"
        aria-label="Отдалить карту"
        disabled={zoom <= 1}
        onClick={() => onZoomChange(Math.max(1, zoom - 1))}
      >
        −
      </button>
      {zoom > 1 ? (
        <button type="button" className="career-chip career-map-zoom-reset" onClick={onResetZoom}>
          Сбросить масштаб
        </button>
      ) : null}
    </div>
  );
}

/** B446-g4: город с карты фильтрует список; полоса над списком снимает фильтр. */
export function VacancyCityFilterBar({
  selectedCity,
  onClear,
}: {
  readonly selectedCity?: string;
  readonly onClear: () => void;
}) {
  if (!selectedCity) return null;
  return (
    <div className="career-map-active-bar">
      <span>
        Показаны вакансии в городе: <strong>{selectedCity}</strong>
      </span>
      <button type="button" className="career-inline-link" onClick={onClear}>
        Все города
      </button>
    </div>
  );
}

function mapNoteCounts(items: readonly MatchedVacancyItem[], total: number): VacancyMapNoteCounts {
  const offMap = items.filter((item) => !hasMapCityCoordinates(item));
  const remoteOffMap = offMap.filter((item) => item.cluster.isRemote).length;
  const office = offMap.filter((item) => !item.cluster.isRemote);
  const missingCity = office.filter((item) => vacancyCityName(item) === undefined).length;
  return {
    onMap: items.length - offMap.length,
    shown: items.length,
    total,
    remoteOffMap,
    missingCity,
    unresolvedCity: office.length - missingCity,
  };
}

function MapHeader({ items, total }: { items: readonly MatchedVacancyItem[]; total: number }) {
  return (
    <div className="career-map-header">
      <p className="career-vacancy-count vacancy-map-note" aria-live="polite">
        <Info size={16} aria-hidden="true" />
        {vacancyMapNote(mapNoteCounts(items, total))}
      </p>
    </div>
  );
}

/** Кластер называет самый крупный город и сколько ещё рядом: «Москва +2». */
function clusterLabel(cluster: ClusterNodeType): string {
  const top = [...cluster.cities].sort((a, b) => b.count - a.count)[0];
  const name = top ? formatCityDisplay(top.city, top.country).city : 'Города';
  return cluster.cities.length > 1 ? `${name} +${cluster.cities.length - 1}` : name;
}

function MapClusterNode({
  cluster,
  zoom,
  onClick,
}: {
  cluster: ClusterNodeType;
  zoom: number;
  onClick: () => void;
}) {
  const citiesNames = cluster.cities
    .map((c) => `${formatCityDisplay(c.city, c.country).city} (${c.count})`)
    .join(', ');
  const tooltip = `Кластер: ${cluster.totalCount} вакансий (${citiesNames}). Нажмите для приближения`;

  return (
    <g
      className="career-map-cluster-group career-map-cluster-node"
      role="button"
      tabIndex={0}
      aria-label={tooltip}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <title>{tooltip}</title>
      <MapCapsule
        x={cluster.x}
        y={cluster.y}
        label={clusterLabel(cluster)}
        count={cluster.totalCount}
        zoom={zoom}
      />
    </g>
  );
}

/**
 * B446-g4: метка карты — капсула «Москва 74», как в макете 4. Размеры делятся на
 * масштаб, чтобы на экране капсула и зона касания (≥44 px) не менялись при приближении.
 */
function MapCapsule({
  x,
  y,
  label,
  count,
  zoom,
  active,
}: {
  x: number;
  y: number;
  label: string;
  count: number;
  zoom: number;
  active?: boolean;
}) {
  const text = `${label} ${count}`;
  const width = text.length * 7.4 + 20;
  return (
    <g transform={`translate(${x} ${y}) scale(${1 / zoom})`}>
      <g className="career-map-capsule-scale">
        <rect
          x={-Math.max(width, 52) / 2}
          y={-26}
          width={Math.max(width, 52)}
          height={52}
          className="career-map-hit"
        />
        <rect
          x={-width / 2}
          y={-12}
          width={width}
          height={24}
          rx={12}
          className={`career-map-capsule${active ? ' is-active' : ''}`}
        />
        <text x={0} y={4.5} textAnchor="middle" className="career-map-label is-capsule">
          <tspan>{label}</tspan>
          <tspan className="career-map-label-count"> {count}</tspan>
        </text>
      </g>
    </g>
  );
}

/** Город, чья капсула наехала бы на соседнюю, — точка; название в подсказке и метке доступности. */
function MapDot({ x, y, zoom }: { x: number; y: number; zoom: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${1 / zoom})`}>
      <g className="career-map-capsule-scale">
        <rect x={-26} y={-26} width={52} height={52} className="career-map-hit" />
        <circle r={5} className="career-map-dot" />
      </g>
    </g>
  );
}

function MapPinNode({
  city,
  isSelected,
  showLabel,
  zoom,
  onSelect,
}: {
  city: CityFacet;
  isSelected: boolean;
  showLabel: boolean;
  zoom: number;
  onSelect: () => void;
}) {
  if (!city.coordinates) return null;
  const { x, y } = projectCoords(city.coordinates.lat, city.coordinates.lng);
  const display = formatCityDisplay(city.city, city.country);

  return (
    <g
      className={`career-map-pin-group ${isSelected ? 'is-active' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`Город ${display.city}: ${city.count} вакансий`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <title>{display.tooltip}</title>
      {showLabel ? (
        <MapCapsule
          x={x}
          y={y}
          label={display.city}
          count={city.count}
          zoom={zoom}
          active={isSelected}
        />
      ) : (
        <MapDot x={x} y={y} zoom={zoom} />
      )}
    </g>
  );
}

function MapSvg({
  cities,
  selectedCity,
  onSelectCity,
  zoom,
  center,
  onZoomChange,
}: {
  cities: readonly CityFacet[];
  selectedCity?: string;
  onSelectCity: (city?: string) => void;
  zoom: number;
  center: { x: number; y: number };
  onZoomChange: (newZoom: number, center?: { x: number; y: number }) => void;
}) {
  const width = Math.round(900 / zoom);
  const height = Math.round(480 / zoom);
  const x = Math.max(0, Math.min(900 - width, Math.round(center.x - width / 2)));
  const y = Math.max(0, Math.min(480 - height, Math.round(center.y - height / 2)));
  const viewBox = `${x} ${y} ${width} ${height}`;

  const nodes = clusterCitiesByGrid(cities, zoom, selectedCity);

  return (
    <svg
      viewBox={viewBox}
      className="career-map-svg"
      role="img"
      aria-label="Контуры стран и расположение городов"
    >
      <rect width="900" height="480" className="career-map-bg" aria-hidden="true" />
      <g className="career-map-country-contours" aria-hidden="true">
        {NATURAL_EARTH_COUNTRY_CONTOURS.map((contour, index) => (
          <path key={index} d={contour} fillRule="evenodd" className="career-map-country" />
        ))}
      </g>
      {nodes.map((node) => renderMapNode(node, selectedCity, onSelectCity, zoom, onZoomChange))}
    </svg>
  );
}

function renderMapNode(
  node: ReturnType<typeof clusterCitiesByGrid>[number],
  selectedCity: string | undefined,
  onSelectCity: (city?: string) => void,
  zoom: number,
  onZoomChange: (newZoom: number, center?: { x: number; y: number }) => void,
) {
  if (node.isCluster) {
    return (
      <MapClusterNode
        key={node.id}
        cluster={node}
        zoom={zoom}
        onClick={() => onZoomChange(Math.min(3, zoom + 1), { x: node.x, y: node.y })}
      />
    );
  }
  return (
    <MapPinNode
      key={node.id}
      city={node.city}
      isSelected={selectedCity === node.city.city}
      showLabel={node.showLabel}
      zoom={zoom}
      onSelect={() => onSelectCity(selectedCity === node.city.city ? undefined : node.city.city)}
    />
  );
}
