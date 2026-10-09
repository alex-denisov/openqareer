import { Info } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { pluralRu } from '../../../shared/pluralRu';
import { VacancyRow } from './VacancyRow';
import { VacancyMapView } from './VacancyMapView';
import { CareerTooltip } from '../shell/CareerTooltip';
import type { ListContentProps } from './VacanciesScreen';
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

function VacanciesListHeader({
  totalCount,
  countShownAbove,
}: {
  readonly totalCount: number;
  readonly countShownAbove: boolean;
}) {
  return (
    <div className={`list-head vacancies-list-head${countShownAbove ? ' has-count-above' : ''}`}>
      {countShownAbove ? null : (
        <span className="list-hint vacancies-list-hint">
          {`${pluralRu(totalCount, ['вакансия', 'вакансии', 'вакансий'])} · показаны совпадающие по роли и уровню`}
        </span>
      )}
      <span className="fit-legend">
        Совпадение: роль · уровень · география
        <CareerTooltip content="Порядок задаёт сервер: сначала роль, уровень и география, затем совпавшие требования; фантомные и сомнительные вакансии ниже, с причиной. «В базе» — дни с первого сбора записи, а не дата публикации.">
          <button
            type="button"
            className="info-btn"
            aria-label="Как устроен порядок и что значит «в базе»"
          >
            <Info size={16} aria-hidden="true" />
          </button>
        </CareerTooltip>
      </span>
    </div>
  );
}

function VacanciesListContent(props: ListContentProps) {
  return (
    <div className="vacancies-list-container">
      <VacanciesListHeader
        totalCount={props.total || props.items.length}
        countShownAbove={props.countShownAbove}
      />
      <ul className="vac-list">
        {props.items.map((item) => (
          <VacancyRow
            key={item.cluster.id}
            item={item}
            now={props.now}
            isSelected={props.selectedId === item.cluster.id}
            onSelect={() => props.onToggleSelect(item.cluster.id)}
            applications={props.applications}
            archivedApplicationClusterIds={props.archivedApplicationClusterIds}
            onMarkAlreadyApplied={props.onMarkAlreadyApplied}
            onScheduleInterview={props.onScheduleInterview}
            onOpenNetworking={props.onOpenNetworking}
            onOpenResponses={props.onOpenResponses}
            onOpenArchive={props.onOpenArchive}
            onAddToProfile={props.onAddToProfile}
            onDiscussWithConsultant={props.onDiscussWithConsultant}
          />
        ))}
      </ul>
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
        selectedCity={props.selectedCity}
        onSelectCity={props.onSelectCity}
      />
    );
  }
  return <VacanciesListContent {...props.listProps} />;
}
