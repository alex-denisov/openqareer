import { useState, type ReactElement } from 'react';
import { Check, MagnifyingGlass } from '@phosphor-icons/react';
import { filterCities, type FirstRunCity } from './firstRunStorage';

export interface FirstRunCitySheetProps {
  readonly isOpen: boolean;
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
                <small className="first-run-city-detail">
                  {item.country}
                </small>
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
        <button type="button" className="first-run-btn-ghost" onClick={onClose} data-testid="city-done-btn">
          Готово
        </button>
      </div>
      <div className="first-run-city-search-wrap">
        <MagnifyingGlass
          size={16}
          className="first-run-city-search-icon"
        />
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

export function FirstRunCitySheet({
  isOpen,
  selectedCity,
  onClose,
  onSelectCity,
}: FirstRunCitySheetProps): ReactElement | null {
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const filtered = filterCities(searchQuery);

  return (
    <div
      className="first-run-modal-dim"
      role="dialog"
      aria-modal="true"
      aria-label="Выбор города"
      data-testid="first-run-city-sheet"
    >
      <div className="first-run-sheet">
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
      </div>
    </div>
  );
}
