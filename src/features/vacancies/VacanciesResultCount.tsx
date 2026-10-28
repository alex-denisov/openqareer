import { List, MapTrifold } from '@phosphor-icons/react';

import { pluralWordRu } from '../../../shared/pluralRu';

const countFormat = new Intl.NumberFormat('ru-RU');

/** «2 051 вакансия», «1 613 вакансий» (W11): падеж по числу. */
export function vacancyNoun(count: number): string {
  return pluralWordRu(count, ['вакансия', 'вакансии', 'вакансий']);
}

/** Строка 390 над списком (макет 4, mv=home): «148 вакансий по вашим условиям» и «Карта». */
export function ResultCount({
  poolTotal,
  shown,
  onToggleView,
  viewMode,
  byFit = false,
}: {
  /** 28.10 mockup: «148 вакансий · по совпадению» when the list is ordered by percent. */
  readonly byFit?: boolean;
  readonly poolTotal?: number;
  readonly shown: number;
  readonly onToggleView: () => void;
  readonly viewMode: 'list' | 'map';
}) {
  const label = 'Показано';
  const ariaCount =
    poolTotal === undefined ? `${label} ${shown}` : `${label} ${shown} из ${poolTotal}`;
  return (
    <div className="vacancies-mobile-results-summary">
      <p className="list-hint" aria-live="polite" aria-label={ariaCount}>
        <span className="vacancy-facet-count">{countFormat.format(shown)}</span>{' '}
        {vacancyNoun(shown)} {byFit ? '· по совпадению' : 'по вашим условиям'}
      </p>
      <button type="button" className="vacancies-mobile-map-action" onClick={onToggleView}>
        {viewMode === 'list' ? <MapTrifold aria-hidden="true" /> : <List aria-hidden="true" />}
        <span>{viewMode === 'list' ? 'Карта' : 'Список'}</span>
      </button>
    </div>
  );
}
