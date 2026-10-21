import { Info, MapTrifold } from '@phosphor-icons/react';
import React from 'react';
import { pluralRu } from '../../../shared/pluralRu';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import {
  calculateVacancyFacets,
  hasMapCityCoordinates,
  vacancyCityName,
  type CityFacet,
} from './vacancyFacets';
import { formatCityDisplay } from './vacancyMapCluster';
import { vacancyMapNote, type VacancyMapNoteCounts } from './vacancyMapNote';

// B553: MapLibre (~1 МБ) грузится отдельным чанком только при открытии «Карты».
const VacancyMapCanvas = React.lazy(() => import('./VacancyMapCanvas'));

interface VacancyMapViewProps {
  readonly items: readonly MatchedVacancyItem[];
  readonly selectedCity?: string;
  readonly onSelectCity: (city?: string) => void;
  /** Вся выдача с условиями (сервер); без неё заметка считает загруженное. */
  readonly total?: number;
  /** «Показать список» в состоянии «Карта недоступна». */
  readonly onShowList?: () => void;
}

export function VacancyMapView({
  items,
  selectedCity,
  onSelectCity,
  total,
  onShowList,
}: VacancyMapViewProps): React.JSX.Element {
  const facets = calculateVacancyFacets(items);
  const [unavailable, setUnavailable] = React.useState(false);
  const markUnavailable = React.useCallback(() => setUnavailable(true), []);
  const leadCity = facets.cities.find((city) => city.city === selectedCity) ?? facets.cities[0];

  return (
    <div className="career-vacancy-map-view vacancy-map-view">
      <div className="career-map-canvas-container">
        <div className="career-map-stage">
          {unavailable ? (
            <VacancyMapUnavailable onShowList={onShowList} />
          ) : (
            <MapChunkBoundary onError={markUnavailable}>
              <React.Suspense fallback={<p className="career-map-status">Загружаем карту…</p>}>
                <VacancyMapCanvas
                  cities={facets.cities}
                  selectedCity={selectedCity}
                  onSelectCity={onSelectCity}
                  onUnavailable={markUnavailable}
                />
              </React.Suspense>
            </MapChunkBoundary>
          )}
          {!unavailable && leadCity?.coordinates ? (
            <MapMobileCard city={leadCity} onShowList={() => onSelectCity(leadCity.city)} />
          ) : null}
        </div>
        <MapHeader items={items} total={total ?? items.length} />
      </div>
    </div>
  );
}

/** B553: на 390 внизу карты — крупнейший (или выбранный) город и «Показать список» (макет 390m). */
function MapMobileCard({
  city,
  onShowList,
}: {
  readonly city: CityFacet;
  readonly onShowList: () => void;
}) {
  return (
    <div className="career-map-mobile-card">
      <div>
        <strong>{formatCityDisplay(city.city, city.country).city}</strong>
        <small>{pluralRu(city.count, ['вакансия', 'вакансии', 'вакансий'])} на карте</small>
      </div>
      <button type="button" className="career-btn is-primary" onClick={onShowList}>
        Показать список
      </button>
    </div>
  );
}

/** B553: офлайн, недоступные тайлы или нет WebGL — честное состояние вместо пустого прямоугольника. */
export function VacancyMapUnavailable({ onShowList }: { readonly onShowList?: () => void }) {
  return (
    <div className="career-map-status is-unavailable" role="status">
      <MapTrifold size={24} aria-hidden="true" />
      <p>Карта недоступна: не удалось загрузить подложку. Вакансии доступны списком.</p>
      {onShowList ? (
        <button type="button" className="career-btn" onClick={onShowList}>
          Показать список
        </button>
      ) : null}
    </div>
  );
}

/** Чанк MapLibre не загрузился (офлайн после выката) — то же честное состояние. */
class MapChunkBoundary extends React.Component<
  { readonly onError: () => void; readonly children: React.ReactNode },
  { readonly failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
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
