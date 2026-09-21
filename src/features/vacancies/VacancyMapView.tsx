import React from "react";
import { ArrowSquareOut, MapPin, Globe } from "@phosphor-icons/react";
import type { MatchedVacancyItem } from "../coach/cabinetTypes";
import { calculateVacancyFacets, type CityFacet } from "./vacancyFacets";
import { employerLabel } from "../../../shared/employerLabel";
import { VacancyConditionBadges } from "./vacancyConditions";

interface VacancyMapViewProps {
  readonly items: readonly MatchedVacancyItem[];
  readonly selectedCity?: string;
  readonly onSelectCity: (city?: string) => void;
}

function projectCoords(lat: number, lng: number): { x: number; y: number } {
  const minLng = -15;
  const maxLng = 60;
  const minLat = 30;
  const maxLat = 65;
  const clampedLng = Math.max(minLng, Math.min(maxLng, lng));
  const clampedLat = Math.max(minLat, Math.min(maxLat, lat));
  const x = Math.round(60 + ((clampedLng - minLng) / (maxLng - minLng)) * 780);
  const y = Math.round(440 - ((clampedLat - minLat) / (maxLat - minLat)) * 380);
  return { x, y };
}

function formatHubNoun(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "город-хаб";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "города-хаба";
  return "городов-хабов";
}

export function VacancyMapView({
  items,
  selectedCity,
  onSelectCity,
}: VacancyMapViewProps): React.JSX.Element {
  const facets = calculateVacancyFacets(items);
  const mappedItems = items.filter(
    (item) => item.cluster.companyFeatures?.coordinates !== undefined,
  );
  const unmappedItems = items.filter(
    (item) => item.cluster.companyFeatures?.coordinates === undefined,
  );

  const displayedMapped = selectedCity
    ? mappedItems.filter((i) => i.cluster.companyFeatures?.city === selectedCity)
    : mappedItems;

  return (
    <div className="career-vacancy-map-view">
      <MapHeader
        onMapCount={facets.onMap.count}
        unmappedCount={facets.onMap.unmappedCount}
        citiesCount={facets.cities.length}
      />

      <div className="career-map-canvas-container">
        <MapSvg
          cities={facets.cities}
          selectedCity={selectedCity}
          onSelectCity={onSelectCity}
        />
      </div>

      <CityChips
        cities={facets.cities}
        selectedCity={selectedCity}
        onSelectCity={onSelectCity}
      />

      <SelectedCityBar
        selectedCity={selectedCity}
        onClear={() => onSelectCity(undefined)}
      />

      <div className="career-map-cards-grid">
        {displayedMapped.map((item) => (
          <MapVacancyCard key={item.cluster.id} item={item} />
        ))}
      </div>

      {unmappedItems.length > 0 ? (
        <UnmappedVacanciesSection items={unmappedItems} />
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
  unmappedCount,
  citiesCount,
}: {
  onMapCount: number;
  unmappedCount: number;
  citiesCount: number;
}) {
  return (
    <div className="career-map-header">
      <p className="career-vacancy-count">
        <strong>{onMapCount}</strong> на карте ·{" "}
        <strong>{unmappedCount}</strong> без точных координат ·{" "}
        <strong>{citiesCount}</strong> {formatHubNoun(citiesCount)}
      </p>
    </div>
  );
}

/**
 * Ширина и высота места, которое занимает подпись хаба. Подписи соседних
 * городов на проде 2026-09-06 легли друг на друга и перестали читаться, поэтому
 * подпись достаётся более крупному хабу, а сосед остаётся точкой (B203).
 */
const LABEL_HALF_WIDTH = 46;
const LABEL_HEIGHT = 16;

function MapPinNode({
  city,
  isSelected,
  showLabel,
  onClick,
}: {
  city: CityFacet;
  isSelected: boolean;
  showLabel: boolean;
  onClick: () => void;
}) {
  if (!city.coordinates) return null;
  const { x, y } = projectCoords(city.coordinates.lat, city.coordinates.lng);
  return (
    <g
      className={`career-map-pin-group ${isSelected ? "is-active" : ""}`}
      onClick={onClick}
      tabIndex={0}
      role="button"
      aria-label={`Город ${city.city}: ${city.count} вакансий`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
    >
      <circle cx={x} cy={y} r={isSelected ? 16 : 10} className="career-map-pulse" />
      <circle cx={x} cy={y} r={isSelected ? 6 : 4} className="career-map-dot" />
      {showLabel ? (
        <text x={x} y={y - 12} textAnchor="middle" className="career-map-label">
          {city.city} ({city.count})
        </text>
      ) : null}
    </g>
  );
}

/**
 * Кто из хабов получает подпись. Идём от самого крупного: подпись рисуется,
 * если её место ещё свободно. Выбранный город подписывается всегда — кандидат
 * должен видеть, что именно он открыл.
 */
function withReadableLabels(
  cities: readonly CityFacet[],
  selectedCity?: string,
): { city: CityFacet; showLabel: boolean }[] {
  const taken: { x: number; y: number }[] = [];
  return [...cities]
    .sort((left, right) => right.count - left.count)
    .map((city) => {
      if (!city.coordinates) return { city, showLabel: false };
      const { x, y } = projectCoords(city.coordinates.lat, city.coordinates.lng);
      const collides = taken.some(
        (spot) => Math.abs(spot.x - x) < LABEL_HALF_WIDTH && Math.abs(spot.y - y) < LABEL_HEIGHT,
      );
      const showLabel = city.city === selectedCity || !collides;
      if (showLabel) taken.push({ x, y });
      return { city, showLabel };
    });
}

function MapSvg({
  cities,
  selectedCity,
  onSelectCity,
}: {
  cities: readonly CityFacet[];
  selectedCity?: string;
  onSelectCity: (city?: string) => void;
}) {
  return (
    <svg
      viewBox="0 0 900 480"
      className="career-map-svg"
      role="img"
      aria-label="Карта распределения вакансий"
    >
      <defs>
        <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
          <path d="M 60 0 L 0 0 0 60" fill="none" stroke="currentColor" strokeOpacity="0.06" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="900" height="480" fill="url(#grid)" className="career-map-bg" />
      {withReadableLabels(cities, selectedCity).map(({ city: c, showLabel }) => (
        <MapPinNode
          key={c.city}
          city={c}
          isSelected={selectedCity === c.city}
          showLabel={showLabel}
          onClick={() => onSelectCity(selectedCity === c.city ? undefined : c.city)}
        />
      ))}
    </svg>
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
    <div className="career-map-city-chips" aria-label="Города на карте">
      {cities.map((c) => {
        const isSelected = selectedCity === c.city;
        return (
          <button
            key={c.city}
            type="button"
            className={`career-chip ${isSelected ? "is-active" : ""}`}
            aria-pressed={isSelected}
            onClick={() => onSelectCity(isSelected ? undefined : c.city)}
          >
            <MapPin size={13} aria-hidden="true" />
            <span>{c.city}</span>
            <strong>{c.count}</strong>
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
            <MapPin size={12} aria-hidden="true" /> {cluster.canonicalLocation}
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
        <h3>Без точных координат ({items.length})</h3>
        <p className="career-cabinet-tag">
          У этих вакансий город не указан или пока не сопоставлен с координатами IT-хабов.
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
