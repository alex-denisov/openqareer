import { describe, expect, it, vi } from 'vitest';
import { mapViewActions } from './vacancyMapScreenActions';
import type { VacanciesScreenState } from './vacanciesScreenState';

const base: VacanciesScreenState = {
  roles: [],
  regions: [],
  remoteOnly: false,
  selectedCity: 'Тверь',
};

describe('B553: список из капсулы карты', () => {
  it('«Показать список» у кластера фильтрует по всем его городам, «К карте» снимает фильтр', () => {
    let state = base;
    const setState = (update: (prev: VacanciesScreenState) => VacanciesScreenState) => {
      state = update(state);
    };
    const setViewMode = vi.fn();
    const actions = mapViewActions(setState, setViewMode);

    actions.onShowCities(['Москва', 'Тверь']);
    expect(state.selectedCities).toEqual(['Москва', 'Тверь']);
    expect(state.selectedCity).toBeUndefined();
    expect(setViewMode).toHaveBeenLastCalledWith('list');

    actions.onBackToMap();
    expect(state.selectedCities).toEqual([]);
    expect(setViewMode).toHaveBeenLastCalledWith('map');
  });
});
