import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { VacancyRow } from './VacancyRow';
import { VacancyMapView } from './VacancyMapView';
import type { ListContentProps } from './VacanciesScreen';
import { Target } from '@phosphor-icons/react';
import { catalogSnapshotLabel } from './VacanciesScreenSummary';
import {
  VacanciesEmptyFilterState,
  VacanciesEmptyPoolState,
  VacanciesErrorState,
  VacanciesSkeletonStack,
} from './VacanciesScreenStates';

interface VacanciesMainBodyProps {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly failureSourceLabel?: string;
  readonly onRetry?: () => void;
  readonly matchedLength: number;
  readonly primaryRole?: string;
  readonly total: number;
  readonly filtered: readonly MatchedVacancyItem[];
  readonly viewMode: 'list' | 'map';
  readonly onResetFilters: () => void;
  readonly listProps: ListContentProps;
  readonly selectedCity?: string;
  readonly onSelectCity: (city?: string) => void;
}

function VacanciesTableHeader() {
  return (
    <div className="vacancies-table-header" role="group" aria-label="Колонки списка вакансий">
      <div className="vacancies-table-header-cells">
        <span>Роль</span>
        <span>Уровень</span>
        <span>Гео</span>
        <span>Деньги</span>
      </div>
      <span className="vacancies-table-header-actions" aria-hidden="true" />
    </div>
  );
}

function VacancyScreenRow({
  item,
  props,
}: {
  readonly item: MatchedVacancyItem;
  readonly props: ListContentProps;
}) {
  return (
    <VacancyRow
      layout="screen"
      item={item}
      now={props.now}
      isSelected={props.selectedId === item.cluster.id}
      onSelect={() => props.onToggleSelect(item.cluster.id)}
      applications={props.applications}
      archivedApplicationClusterIds={props.archivedApplicationClusterIds}
      onMarkAlreadyApplied={props.onMarkAlreadyApplied}
      onScheduleInterview={props.onScheduleInterview}
      onOpenNetworking={props.onOpenNetworking}
      onOpenLetter={props.onOpenLetter}
      onOpenResponses={props.onOpenResponses}
      onOpenArchive={props.onOpenArchive}
      onAddToProfile={props.onAddToProfile}
      onDiscussWithConsultant={props.onDiscussWithConsultant}
      isSaved={props.savedClusterIds?.has(item.cluster.id)}
      saveBusy={props.savedBusyIds?.has(item.cluster.id)}
      isCompanyWanted={props.companyWantByClusterId?.get(item.cluster.id)}
      companyWantKnown={props.companyWantKnownClusterIds?.has(item.cluster.id)}
      companyWantBusy={props.companyBusyClusterIds?.has(item.cluster.id)}
      companyContactsCount={props.companyContactsCountByClusterId?.get(item.cluster.id)}
      onOpenCompanyPath={
        item.cluster.canonicalCompany
          ? () => props.onOpenCompanyPath?.(item.cluster.canonicalCompany)
          : undefined
      }
      onToggleSaved={() => props.onToggleSaved?.(item.cluster)}
      onToggleCompanyWant={() => props.onToggleCompanyWant?.(item.cluster.canonicalCompany)}
    />
  );
}

function VacanciesListContent(props: ListContentProps) {
  const catalogDate = catalogSnapshotLabel(props.catalogObservedAt);
  return (
    <div className="vacancies-list-container">
      <VacanciesTableHeader />
      <ul className="vac-list">
        {props.items.map((item) => (
          <VacancyScreenRow key={item.cluster.id} item={item} props={props} />
        ))}
      </ul>
      <footer className="vacancies-screen-footer" aria-label="Навигация по подборке вакансий">
        <p className="vacancies-screen-page-count" aria-live="polite">
          {props.poolComplete === false ? 'Загружено' : 'Показано'} {props.items.length} из{' '}
          {props.total || props.items.length}
          <span className="vacancies-screen-catalog-date">
            {catalogDate ? `. Каталог на ${catalogDate}.` : '. Дата каталога неизвестна.'}
          </span>
        </p>
        <button
          type="button"
          className="vacancies-screen-companies-action"
          onClick={props.onOpenCompanyCollection}
          disabled={!props.onOpenCompanyCollection}
        >
          <Target size={15} aria-hidden="true" />
          Все компании подборки в «Хочу»
          {props.companiesCount !== undefined ? ` (${props.companiesCount})` : ''}
        </button>
        {props.hasMore ? (
          <button type="button" className="companies-people-load-more" onClick={props.onLoadMore}>
            Показать ещё 20
          </button>
        ) : null}
      </footer>
    </div>
  );
}

export function VacanciesMainBody(props: VacanciesMainBodyProps) {
  if (props.loading) return <VacanciesSkeletonStack />;
  if (props.failed)
    return (
      <VacanciesErrorState failureSourceLabel={props.failureSourceLabel} onRetry={props.onRetry} />
    );
  if (props.matchedLength === 0)
    return <VacanciesEmptyPoolState primaryRole={props.primaryRole} onRetry={props.onRetry} />;
  if (props.filtered.length === 0) {
    return (
      <VacanciesEmptyFilterState
        totalCount={props.total || props.matchedLength}
        onReset={props.onResetFilters}
      />
    );
  }
  if (props.viewMode === 'map') {
    return (
      <VacancyMapView
        items={props.filtered}
        total={props.total}
        selectedCity={props.selectedCity}
        onSelectCity={props.onSelectCity}
      />
    );
  }
  return <VacanciesListContent {...props.listProps} />;
}
