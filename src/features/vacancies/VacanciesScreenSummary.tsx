import type { MatchedVacancyFacets } from '../../../shared/matchedVacancyFacets';

export interface VacanciesScreenSummaryProps {
  readonly poolTotal: number;
  readonly filteredTotal: number;
  readonly shownCount: number;
  readonly poolComplete: boolean;
  readonly activeFilters: number;
  readonly catalogSummary?: MatchedVacancyFacets['catalogSummary'];
  readonly onReset: () => void;
}

function countLabel(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function snapshotLabel(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(parsed);
}

export function VacanciesScreenSummary({
  poolTotal,
  filteredTotal,
  shownCount,
  poolComplete,
  activeFilters,
  catalogSummary,
  onReset,
}: VacanciesScreenSummaryProps) {
  const catalogCount = catalogSummary?.roleLevelMatches ?? poolTotal;
  const catalogTotal = catalogSummary?.catalogTotal;
  const asOf = snapshotLabel(catalogSummary?.observedAt);
  const headline = catalogTotal
    ? `${countLabel(catalogCount)} из ${countLabel(catalogTotal)} вакансий каталога подходят по роли и уровню.`
    : `${countLabel(poolTotal)} вакансий в подборке по роли и уровню.`;
  const shownLabel = poolComplete ? 'Показано' : 'Загружено';

  return (
    <section className="vacancies-search-summary" aria-label="Сводка подбора">
      <span className="vacancies-summary-count" aria-hidden="true">
        {countLabel(catalogCount)}
      </span>
      <p className="vacancies-summary-copy">
        <span>{headline}</span>
        <span>
          {shownLabel} {countLabel(shownCount)} из {countLabel(filteredTotal)} с вашими условиями
          {asOf ? ` · каталог на ${asOf}` : ''}
        </span>
      </p>
      <button
        type="button"
        className="vacancies-summary-reset"
        disabled={activeFilters === 0}
        onClick={onReset}
      >
        Сбросить всё
      </button>
    </section>
  );
}
