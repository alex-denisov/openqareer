import { useEscapeLayer } from '../shell/escapeLayers';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Check, MagnifyingGlass } from '@phosphor-icons/react';
import { filterCities, type FirstRunCity } from './firstRunStorage';

export interface FirstRunCitySheetProps {
  readonly isOpen: boolean;
  readonly isMobile?: boolean;
  readonly selectedCity: string;
  readonly onClose: () => void;
  readonly onSelectCity: (city: FirstRunCity) => void;
}

function CityListItems({
  cities,
  selectedCity,
  onPick,
}: {
  readonly cities: readonly FirstRunCity[];
  readonly selectedCity: string;
  readonly onPick: (city: FirstRunCity) => void;
}): ReactElement {
  return (
    <ul className="first-run-city-list" data-testid="city-results-list">
      {cities.map((item) => {
        const isPicked = item.name === selectedCity;
        return (
          <li key={item.name}>
            <button
              type="button"
              className={`first-run-city-item ${isPicked ? 'is-selected' : ''}`}
              onClick={() => onPick(item)}
              data-testid={`city-item-${item.name}`}
            >
              <div>
                <b className="first-run-city-name">{item.name}</b>
                <small className="first-run-city-detail">{item.country}</small>
              </div>
              {isPicked ? <Check size={16} /> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function CitySearchHeader({
  query,
  onQueryChange,
  onClose,
}: {
  readonly query: string;
  readonly onQueryChange: (q: string) => void;
  readonly onClose: () => void;
}): ReactElement {
  return (
    <>
      <div className="first-run-city-header">
        <h2 className="first-run-city-title">Город</h2>
        <button
          type="button"
          className="first-run-btn-ghost"
          onClick={onClose}
          data-testid="city-done-btn"
        >
          Готово
        </button>
      </div>
      <div className="first-run-city-search-wrap">
        <MagnifyingGlass size={16} className="first-run-city-search-icon" />
        <input
          type="search"
          className="first-run-input first-run-city-search-input"
          placeholder="Поиск города"
          aria-label="Поиск города"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          data-testid="city-search-input"
        />
      </div>
    </>
  );
}

function useCityDialog(isOpen: boolean, isMobile: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEscapeLayer(onClose, isOpen);
  useEffect(() => {
    if (!isOpen) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector('input')?.focus();
    return () => {
      trigger?.focus();
    };
  }, [isOpen]);
  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    if (!panel) return;
    const handleKeyDown = (event: KeyboardEvent) =>
      cityDialogKeyDown(event, panel, isMobile, onClose);
    panel.addEventListener('keydown', handleKeyDown);
    return () => panel.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isMobile, onClose]);
  return panelRef;
}

function cityDialogKeyDown(
  event: KeyboardEvent,
  panel: HTMLElement,
  isMobile: boolean,
  onClose: () => void,
) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }
  if (!isMobile || event.key !== 'Tab') return;
  const controls = panel.querySelectorAll<HTMLElement>('button, input');
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

export function FirstRunCitySheet({
  isOpen,
  isMobile = false,
  selectedCity,
  onClose,
  onSelectCity,
}: FirstRunCitySheetProps): ReactElement | null {
  const [searchQuery, setSearchQuery] = useState('');
  const panelRef = useCityDialog(isOpen, isMobile, onClose);
  useEffect(() => {
    if (isOpen) setSearchQuery('');
  }, [isOpen]);

  if (!isOpen) return null;

  const filtered = filterCities(searchQuery);

  return (
    <div
      ref={panelRef}
      className={`first-run-city-layer${isMobile ? ' is-mobile' : ''}`}
      role="dialog"
      aria-modal={isMobile || undefined}
      aria-label="Выбор города"
      data-testid="first-run-city-sheet"
    >
      <div className="first-run-sheet first-run-city-panel">
        <CitySearchHeader query={searchQuery} onQueryChange={setSearchQuery} onClose={onClose} />
        <p className="first-run-city-section-label">
          {searchQuery ? 'Результаты поиска' : 'Популярные'}
        </p>
        <CityListItems
          cities={filtered}
          selectedCity={selectedCity}
          onPick={(c) => {
            onSelectCity(c);
            onClose();
          }}
        />
        {filtered.length === 0 ? (
          <p className="first-run-city-section-label" role="status">
            Город не найден. Проверьте запрос.
          </p>
        ) : null}
      </div>
    </div>
  );
}
