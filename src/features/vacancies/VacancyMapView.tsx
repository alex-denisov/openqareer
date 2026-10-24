import { CaretLeft, Info, MapTrifold, Sparkle } from '@phosphor-icons/react';
import React from 'react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { useCompactViewport } from './useCompactViewport';
import { calculateVacancyFacets, hasMapCityCoordinates, vacancyCityName } from './vacancyFacets';
import { vacancyMapNote, vacancyMapShortNote, type VacancyMapNoteCounts } from './vacancyMapNote';

// B553: MapLibre (~1 МБ) грузится отдельным чанком только при открытии «Карты».
const VacancyMapCanvas = React.lazy(() => import('./VacancyMapCanvas'));

interface VacancyMapViewProps {
  readonly items: readonly MatchedVacancyItem[];
  readonly selectedCity?: string;
  readonly onSelectCity: (city?: string) => void;
  /** Вся выдача с условиями (сервер); без неё заметка считает загруженное. */
  readonly total?: number;
  /** Назад к списку: «Показать список» в ошибке и «Назад» push-экрана 390. */
  readonly onShowList?: () => void;
  /** 390: «Показать список» карточки — все города капсулы (у кластера их несколько). */
  readonly onShowCities?: (cities: readonly string[]) => void;
  /** 390: консультант справа в шапке push-экрана «Карта». */
  readonly onOpenExpert?: () => void;
}

export function VacancyMapView(props: VacancyMapViewProps): React.JSX.Element {
  const compact = useCompactViewport();
  if (compact) return <VacancyMapPush {...props} />;
  return (
    <div className="career-vacancy-map-view vacancy-map-view">
      <div className="career-map-canvas-container">
        <VacancyMapStage {...props} compact={false} />
        <MapHeader items={props.items} total={props.total ?? props.items.length} />
      </div>
    </div>
  );
}

function VacancyMapStage({
  items,
  selectedCity,
  onSelectCity,
  onShowList,
  onShowCities,
  compact,
}: VacancyMapViewProps & { readonly compact: boolean }) {
  const facets = calculateVacancyFacets(items);
  const [unavailable, setUnavailable] = React.useState(false);
  const markUnavailable = React.useCallback(() => setUnavailable(true), []);
  return (
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
              onShowCities={onShowCities ?? ((cities) => onSelectCity(cities[0]))}
              onUnavailable={markUnavailable}
              compact={compact}
            />
          </React.Suspense>
        </MapChunkBoundary>
      )}
    </div>
  );
}

/** Push-экран открывается с фокусом на «Назад»; Escape — тоже назад. */
function usePushBack(onBack?: () => void) {
  const backRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    backRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) onBack?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onBack]);
  return backRef;
}

/**
 * B553: на 390 «Карта» — отдельный push-экран (макет 4 `?mv=map`): круглая кнопка
 * назад, заголовок, консультант справа; карта карточкой, заметка под ней.
 */
function VacancyMapPush(props: VacancyMapViewProps) {
  const { onShowList, onOpenExpert } = props;
  const backRef = usePushBack(onShowList);
  return (
    <>
      <div className="vacancy-push-backdrop" aria-hidden="true" />
      <div
        className="vacancy-push vacancy-map-view career-map-push"
        role="dialog"
        aria-labelledby="vacancy-map-push-title"
      >
        <header className="vacancy-push-bar">
          <button
            ref={backRef}
            type="button"
            className="vacancy-push-back"
            aria-label="Назад"
            onClick={onShowList}
          >
            <CaretLeft size={20} aria-hidden="true" />
          </button>
          <h1 id="vacancy-map-push-title">Карта</h1>
          {onOpenExpert ? (
            <button
              type="button"
              className="career-map-push-expert"
              aria-label="Спросить консультанта"
              onClick={onOpenExpert}
            >
              <Sparkle size={20} aria-hidden="true" />
            </button>
          ) : null}
        </header>
        <div className="career-map-push-body">
          <div className="career-map-canvas-container">
            <VacancyMapStage {...props} compact />
          </div>
          <MapPushNote counts={mapNoteCounts(props.items, props.total ?? props.items.length)} />
        </div>
      </div>
    </>
  );
}

/** 390: одна строка под картой, как в макете 4; кнопки «i» в макете нет. */
function MapPushNote({ counts }: { counts: VacancyMapNoteCounts }) {
  return (
    <div className="career-map-push-note">
      <p className="vacancy-map-note" aria-live="polite">
        {vacancyMapShortNote(counts)}
      </p>
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

/**
 * B446-g4: город с карты фильтрует список; полоса над списком снимает фильтр.
 * B553: у кластера — чипы всех его городов и «К карте».
 */
export function VacancyCityFilterBar({
  selectedCity,
  selectedCities = [],
  onClear,
  onBackToMap,
}: {
  readonly selectedCity?: string;
  readonly selectedCities?: readonly string[];
  readonly onClear: () => void;
  readonly onBackToMap?: () => void;
}) {
  const cities = selectedCities.length ? selectedCities : selectedCity ? [selectedCity] : [];
  if (!cities.length) return null;
  return (
    <div className="career-map-active-bar">
      {cities.length === 1 ? (
        <span>
          Показаны вакансии в городе: <strong>{cities[0]}</strong>
        </span>
      ) : (
        <ul className="career-map-city-chips" aria-label="Города с карты">
          {cities.map((city) => (
            <li key={city} className="career-chip">
              {city}
            </li>
          ))}
        </ul>
      )}
      {onBackToMap ? (
        <button type="button" className="career-inline-link" onClick={onBackToMap}>
          К карте
        </button>
      ) : (
        <button type="button" className="career-inline-link" onClick={onClear}>
          Все города
        </button>
      )}
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
