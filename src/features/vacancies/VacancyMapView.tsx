import React from "react";
import { ArrowSquareOut, MapPin, Globe } from "@phosphor-icons/react";
import type { MatchedVacancyItem } from "../coach/cabinetTypes";
import { calculateVacancyFacets, hasMapCityCoordinates, type CityFacet } from "./vacancyFacets";
import { employerLabel } from "../../../shared/employerLabel";
import { VacancyConditionBadges } from "./vacancyConditions";
import { NATURAL_EARTH_COUNTRY_CONTOURS } from "./naturalEarth110m";
import {
  clusterCitiesByGrid,
  formatCityDisplay,
  formatLocationDisplay,
  projectCoords,
  type MapClusterNode as ClusterNodeType,
} from "./vacancyMapCluster";

interface VacancyMapViewProps {
  readonly items: readonly MatchedVacancyItem[];
  readonly selectedCity?: string;
  readonly onSelectCity: (city?: string) => void;
}

function coordinateKey(point: { readonly lat: number; readonly lng: number }): string {
  return `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`;
}

function getMapVacancies(
  items: readonly MatchedVacancyItem[],
  cities: readonly CityFacet[],
  selectedCity?: string,
) {
  const mappedItems: MatchedVacancyItem[] = [];
  const unmappedItems: MatchedVacancyItem[] = [];
  for (const item of items) {
    (hasMapCityCoordinates(item) ? mappedItems : unmappedItems).push(item);
  }
  const selectedHub = cities.find((city) => city.city === selectedCity)?.coordinates;
  const selectedHubKey = selectedHub ? coordinateKey(selectedHub) : undefined;
  const displayedMapped = selectedCity
    ? mappedItems.filter((item) => {
        const coordinates = item.cluster.companyFeatures?.coordinates;
        return (
          (selectedHubKey !== undefined &&
            coordinates !== undefined &&
            coordinateKey(coordinates) === selectedHubKey) ||
          item.cluster.companyFeatures?.city === selectedCity
        );
      })
    : mappedItems;
  return { displayedMapped, unmappedItems };
}

export function VacancyMapView({
  items,
  selectedCity,
  onSelectCity,
}: VacancyMapViewProps): React.JSX.Element {
  const [zoom, setZoom] = React.useState<number>(1);
  const [center, setCenter] = React.useState<{ x: number; y: number }>({ x: 450, y: 240 });
  const facets = calculateVacancyFacets(items);
  const { displayedMapped, unmappedItems } = getMapVacancies(items, facets.cities, selectedCity);

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
      </div>

      <MapZoomControls
        zoom={zoom}
        onZoomChange={(newZoom) => setZoom(newZoom)}
        onResetZoom={() => {
          setZoom(1);
          setCenter({ x: 450, y: 240 });
        }}
      />

      <MapHeader
        onMapCount={facets.onMap.count}
        total={facets.onMap.total}
        missingCityCount={facets.onMap.missingCityCount}
        unresolvedCityCount={facets.onMap.unresolvedCityCount}
      />

      <CityChips cities={facets.cities} selectedCity={selectedCity} onSelectCity={onSelectCity} />
      <SelectedCityBar selectedCity={selectedCity} onClear={() => onSelectCity(undefined)} />
      <MapCardsSection displayedMapped={displayedMapped} unmappedItems={unmappedItems} />
    </div>
  );
}

function MapCardsSection({
  displayedMapped,
  unmappedItems,
}: {
  displayedMapped: readonly MatchedVacancyItem[];
  unmappedItems: readonly MatchedVacancyItem[];
}) {
  return (
    <>
      <div className="career-map-cards-grid">
        {displayedMapped.map((item) => (
          <MapVacancyCard key={item.cluster.id} item={item} />
        ))}
      </div>
      {unmappedItems.length > 0 ? (
        <UnmappedVacanciesSection items={unmappedItems} />
      ) : null}
    </>
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
        <button
          type="button"
          className="career-chip career-map-zoom-reset"
          onClick={onResetZoom}
        >
          Сбросить масштаб
        </button>
      ) : null}
    </div>
  );
}

function SelectedCityBar({
  selectedCity,
  onClear,
}: {
  selectedCity?: string;
  onClear: () => void;
}) {
  if (!selectedCity) return null;
  return (
    <div className="career-map-active-bar">
      <span>Показаны вакансии в городе: <strong>{selectedCity}</strong></span>
      <button
        type="button"
        className="career-inline-link"
        onClick={onClear}
      >
        Все города на карте
      </button>
    </div>
  );
}

function MapHeader({
  onMapCount,
  total,
  missingCityCount,
  unresolvedCityCount,
}: {
  onMapCount: number;
  total: number;
  missingCityCount: number;
  unresolvedCityCount: number;
}) {
  return (
    <div className="career-map-header">
      <p className="career-vacancy-count" aria-live="polite">
        На карте <strong>{onMapCount}</strong> из <strong>{total}</strong> · без города:{" "}
        <strong>{missingCityCount}</strong> · город не распознан:{" "}
        <strong>{unresolvedCityCount}</strong>
      </p>
    </div>
  );
}

function MapClusterNode({
  cluster,
  onClick,
}: {
  cluster: ClusterNodeType;
  onClick: () => void;
}) {
  const citiesNames = cluster.cities
    .map((c) => `${formatCityDisplay(c.city, c.country).city} (${c.count})`)
    .join(", ");
  const tooltip = `Кластер: ${cluster.totalCount} вакансий (${citiesNames}). Нажмите для приближения`;

  return (
    <g
      className="career-map-cluster-group career-map-cluster-node"
      role="button"
      tabIndex={0}
      aria-label={tooltip}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <title>{tooltip}</title>
      <circle cx={cluster.x} cy={cluster.y} r={18} className="career-map-cluster-pulse" />
      <circle cx={cluster.x} cy={cluster.y} r={12} className="career-map-cluster-circle" />
      <text
        x={cluster.x}
        y={cluster.y + 4}
        textAnchor="middle"
        className="career-map-cluster-count"
      >
        {cluster.totalCount}
      </text>
    </g>
  );
}

function MapPinNode({
  city,
  isSelected,
  showLabel,
  onSelect,
}: {
  city: CityFacet;
  isSelected: boolean;
  showLabel: boolean;
  onSelect: () => void;
}) {
  if (!city.coordinates) return null;
  const { x, y } = projectCoords(city.coordinates.lat, city.coordinates.lng);
  const display = formatCityDisplay(city.city, city.country);

  return (
    <g
      className={`career-map-pin-group ${isSelected ? "is-active" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`Город ${display.city}: ${city.count} вакансий`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <title>{display.tooltip}</title>
      <circle cx={x} cy={y} r={isSelected ? 16 : 10} className="career-map-pulse" />
      <circle cx={x} cy={y} r={isSelected ? 6 : 4} className="career-map-dot" />
      {showLabel ? (
        <text x={x} y={y - 12} textAnchor="middle" className="career-map-label">
          <tspan>{display.city}</tspan>
          <tspan className="career-map-label-count"> · {city.count}</tspan>
        </text>
      ) : null}
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
      onSelect={() => onSelectCity(selectedCity === node.city.city ? undefined : node.city.city)}
    />
  );
}

function CityChips({
  cities,
  selectedCity,
  onSelectCity,
}: {
  cities: readonly CityFacet[];
  selectedCity?: string;
  onSelectCity: (city?: string) => void;
}) {
  if (cities.length === 0) return null;
  return (
    <div className="career-map-city-chips vacancy-map-cities" aria-label="Города на карте">
      {cities.map((c) => {
        const isSelected = selectedCity === c.city;
        const display = formatCityDisplay(c.city, c.country);
        return (
          <button
            key={c.city}
            type="button"
            className={`career-chip ${isSelected ? "is-active" : ""}`}
            aria-pressed={isSelected}
            aria-label={`Город ${display.city}: ${c.count} вакансий`}
            title={display.tooltip}
            onClick={() => onSelectCity(isSelected ? undefined : c.city)}
          >
            <MapPin size={13} aria-hidden="true" />
            <span>{display.city}</span>
            <span className="career-map-city-count">
              <span aria-hidden="true">·</span>
              <span className="career-map-city-count-value">{c.count}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function MapVacancyCard({ item }: { item: MatchedVacancyItem }) {
  const { cluster } = item;
  const feat = cluster.companyFeatures;

  return (
    <article className="career-map-card">
      <div className="career-map-card-head">
        <h4>{cluster.canonicalTitle}</h4>
        <span className="career-map-card-company">{employerLabel(cluster.canonicalCompany)}</span>
      </div>

      <div className="career-map-card-meta">
        {cluster.canonicalLocation ? (
          <span className="career-cabinet-tag">
            <MapPin size={12} aria-hidden="true" /> {formatLocationDisplay(cluster.canonicalLocation)}
          </span>
        ) : null}
        {feat?.industry ? (
          <span className="career-cabinet-tag">
            <Globe size={12} aria-hidden="true" /> {feat.industry}
          </span>
        ) : null}
      </div>

      <div className="career-map-card-features">
        <VacancyConditionBadges features={feat} />
      </div>

      <div className="career-map-card-actions">
        <a
          href={cluster.primaryUrl}
          target="_blank"
          rel="noreferrer"
          className="career-inline-link"
        >
          Открыть вакансию <ArrowSquareOut size={13} aria-hidden="true" />
        </a>
      </div>
    </article>
  );
}

function UnmappedVacanciesSection({
  items,
}: {
  items: readonly MatchedVacancyItem[];
}) {
  return (
    <section className="career-map-unmapped-section">
      <header>
        <h3>Не показаны на карте ({items.length})</h3>
        <p className="career-cabinet-tag">
          У этих вакансий город не указан или его координаты не удалось сопоставить с локальным справочником.
          Данные не отбрасываются и остаются доступными для поиска:
        </p>
      </header>
      <div className="career-map-cards-grid">
        {items.map((item) => (
          <MapVacancyCard key={item.cluster.id} item={item} />
        ))}
      </div>
    </section>
  );
}
