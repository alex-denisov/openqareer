import { useState, type ReactElement } from 'react';
import { Check, MagnifyingGlass } from '@phosphor-icons/react';
import { filterCities, POPULAR_CITIES, type FirstRunCity } from './firstRunStorage';

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
                <b style={{ display: 'block', fontSize: 'var(--career-text-sm, 14px)' }}>{item.name}</b>
                <small style={{ fontSize: 'var(--career-text-xs, 12px)', color: 'var(--career-color-muted, #94a3b8)' }}>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--career-text-base, 16px)' }}>Город</h2>
        <button type="button" className="first-run-btn-ghost" onClick={onClose} data-testid="city-done-btn">
          Готово
        </button>
      </div>
      <div style={{ position: 'relative', marginBottom: '12px' }}>
        <MagnifyingGlass
          size={16}
          style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--career-color-muted, #94a3b8)' }}
        />
        <input
          type="search"
          className="first-run-input"
          style={{ width: '100%', boxSizing: 'border-box', paddingLeft: '36px' }}
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

  const filtered = filterCities(searchQuery, POPULAR_CITIES);

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
        <p style={{ margin: '0 0 8px', fontSize: 'var(--career-text-xs, 12px)', color: 'var(--career-color-muted, #94a3b8)' }}>
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
