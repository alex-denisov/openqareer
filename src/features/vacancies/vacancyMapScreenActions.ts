import type { VacanciesScreenState } from './vacanciesScreenState';

type SetScreenState = (update: (prev: VacanciesScreenState) => VacanciesScreenState) => void;

/** Переходы между картой и списком «Вакансий» с фильтром городов карты. */
export function mapViewActions(
  setState: SetScreenState,
  setViewMode: (mode: 'list' | 'map') => void,
) {
  return {
    // B446-g4: город на карте открывает список, отфильтрованный по этому городу.
    onSelectCity: (city?: string) => {
      setState((prev) => ({ ...prev, selectedCity: city, selectedCities: [] }));
      if (city) setViewMode('list');
    },
    // B553: «Показать список» карточки 390 — все города капсулы (кластера) сразу.
    onShowCities: (cities: readonly string[]) => {
      setState((prev) => ({ ...prev, selectedCity: undefined, selectedCities: cities }));
      setViewMode('list');
    },
    // Назад из такого списка — снова карта целиком.
    onBackToMap: () => {
      setState((prev) => ({ ...prev, selectedCities: [] }));
      setViewMode('map');
    },
  };
}
