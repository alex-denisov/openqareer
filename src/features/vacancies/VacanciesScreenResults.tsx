import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { VacancyRow } from './VacancyRow';
import { VacancyCityFilterBar, VacancyMapView } from './VacancyMapView';
import { VacancySortHeader } from './VacancyFitSort';
import { DEFAULT_VACANCY_SORT } from '../../../shared/vacancySort';
import { vacancyFitMark } from './vacancyFitModel';
import type { ListContentProps } from './VacanciesScreen';
import { BulkCompanyWantButton } from './BulkCompanyWantButton';
import type { SavedCardRenderer } from './SavedVacanciesPanel';
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
  readonly selectedCities?: readonly string[];
  readonly onShowCities?: (cities: readonly string[]) => void;
  readonly onBackToMap?: () => void;
  readonly onSelectCity: (city?: string) => void;
  /** B553: карта недоступна — переход к списку. */
  readonly onShowList?: () => void;
  /** B553: консультант из шапки push-экрана «Карта» (390). */
  readonly onOpenExpert?: () => void;
}

/** 29.10: «Деньги» and «Совпадение» sort the list; without a handler they stay plain. */
function SortableHeaderCells({
  sort = DEFAULT_VACANCY_SORT,
  onSortChange,
}: Pick<ListContentProps, 'sort' | 'onSortChange'>) {
  if (!onSortChange)
    return (
      <>
        <span role="columnheader">Деньги</span>
        <span role="columnheader">Совпадение</span>
      </>
    );
  return (
    <>
      <VacancySortHeader column="money" label="Деньги" sort={sort} onSort={onSortChange} />
      <VacancySortHeader column="fit" label="Совпадение" sort={sort} onSort={onSortChange} />
    </>
  );
}

function VacanciesTableHeader({
  sort,
  onSortChange,
  items,
  onOpenResumeUpload,
}: Pick<ListContentProps, 'sort' | 'onSortChange' | 'items' | 'onOpenResumeUpload'>) {
  const noProfile = items.some((item) => {
    const mark = vacancyFitMark(item.explanation.fitView);
    return mark.kind === 'none' && mark.caption === 'нет профиля';
  });
  return (
    <>
      {noProfile && onOpenResumeUpload ? (
        <div className="vacancy-fit-no-profile">
          <p>
            Без профиля процента нет. Загрузите резюме — проценты посчитаются для всей подборки.
          </p>
          <button type="button" className="career-btn is-primary" onClick={onOpenResumeUpload}>
            Загрузить резюме
          </button>
        </div>
      ) : null}
      <div className="vacancies-table-header" role="table" aria-label="Колонки списка вакансий">
        <div className="vacancies-table-header-cells" role="row">
          <span role="columnheader">Роль</span>
          <span role="columnheader">Уровень</span>
          <span role="columnheader">Гео</span>
          <SortableHeaderCells sort={sort} onSortChange={onSortChange} />
        </div>
        <span className="vacancies-table-header-actions" />
      </div>
    </>
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

const pageCount = new Intl.NumberFormat('ru-RU');

function VacanciesListContent(props: ListContentProps) {
  const catalogDate = catalogSnapshotLabel(props.catalogObservedAt);
  return (
    <div className="vacancies-list-container">
      <VacanciesTableHeader
        sort={props.sort}
        onSortChange={props.onSortChange}
        items={props.items}
        onOpenResumeUpload={props.onOpenResumeUpload}
      />
      <ul className="vac-list">
        {props.items.map((item) => (
          <VacancyScreenRow key={item.cluster.id} item={item} props={props} />
        ))}
      </ul>
      <footer className="vacancies-screen-footer" aria-label="Навигация по подборке вакансий">
        <p className="vacancies-screen-page-count" aria-live="polite">
          {/* B446-g4: показанные из выдачи с условиями; догрузка пула — отдельной пометкой. */}
          Показано {pageCount.format(props.items.length)} из{' '}
          {pageCount.format(props.total || props.items.length)}
          {props.poolComplete === false ? ' · загружаем остальные' : null}
          <span className="vacancies-screen-catalog-date">
            {catalogDate ? `. Каталог на ${catalogDate}.` : '. Дата каталога неизвестна.'}
          </span>
        </p>
        <BulkCompanyWantButton
          count={props.companiesCount}
          className="vacancies-screen-companies-action vac-sm"
          onDone={() => props.onCompanyWantsChanged?.()}
        />
        {props.hasMore ? (
          <button
            type="button"
            className="companies-people-load-more vac-sm"
            onClick={props.onLoadMore}
          >
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
        onShowList={props.onShowList}
        onShowCities={props.onShowCities}
        onOpenExpert={props.onOpenExpert}
      />
    );
  }
  return (
    <>
      <VacancyCityFilterBar
        selectedCity={props.selectedCity}
        selectedCities={props.selectedCities}
        onClear={() => props.onSelectCity(undefined)}
        onBackToMap={props.selectedCities?.length ? props.onBackToMap : undefined}
      />
      <VacanciesListContent {...props.listProps} />
    </>
  );
}

/** B446-g4: «раскрыть» в «Сохранённых» — та же строка подборки, раскрытая; её шеврон сворачивает. */
export function savedCardRenderer(listProps: ListContentProps): SavedCardRenderer {
  return (item, onCollapse) => (
    <VacancyScreenRow
      item={item}
      props={{ ...listProps, selectedId: item.cluster.id, onToggleSelect: onCollapse }}
    />
  );
}
