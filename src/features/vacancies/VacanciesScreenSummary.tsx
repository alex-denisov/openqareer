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

/** «07.10 09:12» по Москве, как в макете 4; неразборная дата — нет подписи. */
export function catalogSnapshotLabel(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  })
    .format(parsed)
    .replace(', ', ' ');
}

function summaryHeadline(catalogSummary: MatchedVacancyFacets['catalogSummary']): string {
  if (catalogSummary?.catalogTotal === undefined) {
    return 'вакансий подходят по роли и уровню.';
  }
  return (
    'из ' +
    countLabel(catalogSummary.catalogTotal) +
    ' вакансий каталога подходят по роли и уровню.'
  );
}

function catalogProvenance(
  catalogSummary: MatchedVacancyFacets['catalogSummary'],
  asOf?: string,
): string {
  if (catalogSummary?.catalogTotal === undefined) return 'размер и дата каталога неизвестны';
  return asOf ? 'каталог на ' + asOf : 'дата каталога неизвестна';
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
  const catalogCount =
    catalogSummary?.catalogTotal !== undefined ? catalogSummary.roleLevelMatches : poolTotal;
  const asOf = catalogSnapshotLabel(catalogSummary?.observedAt);

  return (
    <section className="vacancies-search-summary" aria-label="Сводка подбора">
      <span className="vacancies-summary-count">{countLabel(catalogCount)}</span>{' '}
      <p className="vacancies-summary-copy">
        {summaryHeadline(catalogSummary)} Показано {countLabel(shownCount)} из{' '}
        {countLabel(filteredTotal)} с вашими условиями
        {poolComplete ? null : ' · загружаем остальные'}
        <span className="vacancies-summary-provenance">
          {' · '}
          {catalogProvenance(catalogSummary, asOf)}
        </span>
      </p>
      <button
        type="button"
        className="vacancies-summary-reset vac-sm is-ghost"
        disabled={activeFilters === 0}
        onClick={onReset}
      >
        Сбросить всё
      </button>
    </section>
  );
}
