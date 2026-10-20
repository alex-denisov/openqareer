import type { ReactNode } from 'react';
import type { ApplicationStage } from '../../../shared/applicationStage';
import type { ApplicationListPageMeta, ApplicationView } from './applicationsApi';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { ResponsesApplicationsTable, ResponsesMobileFeed } from './ResponsesApplicationsTable';
import {
  ResponsesAutomationLink,
  usePendingAutomationApprovalCount,
} from './ResponsesAutomationLink';
import { ResponsesOffersPanel } from './ResponsesOffersPanel';
import { CompanyWantsPanel } from './ResponsesCompanyWants';
import { ResponsesPreparationPanel } from './ResponsesPreparationPanel';
import { ResponsesPipelineAnalytics } from './ResponsesPipelineAnalytics';
import { ResponsesChannelPerformance } from './ResponsesChannelPerformance';
import { SelectedResponsePanel } from './SelectedResponsePanel';
import {
  ResponsesFunnelSummary,
  ResponsesFilterControls,
  ResponsesWorkspaceNavigation,
  type ResponsesWorkspaceSection,
} from './ResponsesWorkspaceControls';
import type { UseApplications } from './useApplications';
import { OPEN_APPLICATION_STAGES, useWorkspaceController } from './responsesWorkspaceController';
import type { WorkspaceController } from './responsesWorkspaceController';
import './responses-workspace.css';
import './responses-mobile.css';

export interface ResponsesColumnsContentInput {
  readonly applications: readonly ApplicationView[];
  readonly selectedId?: string;
  readonly onSelectApplication: (id: string) => void;
  readonly visibleCounts: Readonly<Record<string, number>>;
  readonly onLoadMore: (column: string) => void;
  readonly onSwitchToTable: () => void;
  readonly onClearFilter: () => void;
}

export interface ResponsesWorkspaceScreenProps {
  readonly state: UseApplications;
  readonly stageFilter?: ApplicationStage | null;
  readonly onStageFilterChange: (stage: ApplicationStage | null) => void;
  readonly onClearFilter?: () => void;
  readonly onOpenVacancies: () => void;
  readonly onOpenAutomation?: () => void;
  readonly initialTab?: 'board' | 'analytics';
  readonly initialApplicationId?: string;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
  readonly columnsContent: (input: ResponsesColumnsContentInput) => ReactNode;
  readonly emptyContent: ReactNode;
}

function WorkspacePanelContent({
  section,
  props,
  workspace,
  tableView,
}: {
  readonly section: ResponsesWorkspaceSection;
  readonly props: ResponsesWorkspaceScreenProps;
  readonly workspace: WorkspaceController;
  readonly tableView: ReactNode;
}) {
  switch (section) {
    case 'funnel':
      return <FunnelWorkspace props={props} workspace={workspace} tableView={tableView} />;
    case 'company-wants':
      return <CompanyWantsPanel />;
    case 'preparation':
      return (
        <ResponsesPreparationPanel
          applications={props.state.applications}
          onOpenExpert={props.onOpenExpert}
          onRefresh={props.state.reload}
        />
      );
    case 'offers':
      return <ResponsesOffersPanel state={props.state} />;
  }
}

export function ResponsesWorkspaceScreen(props: ResponsesWorkspaceScreenProps) {
  const workspace = useWorkspaceController(props);
  const tableView = renderTableView({ state: props.state, workspace });
  const sections: readonly ResponsesWorkspaceSection[] = [
    'funnel',
    'company-wants',
    'preparation',
    'offers',
  ];
  return (
    <div className="career-responses-board-wrap">
      <ResponsesWorkspaceNavigation
        section={workspace.section}
        onChange={workspace.setSection}
        counts={workspace.stageCounts}
      />
      {sections.map((section) => {
        const active = workspace.section === section;
        return (
          <div
            key={section}
            id={'career-responses-tab-panel-' + section}
            className="career-responses-tab-panel"
            role="tabpanel"
            aria-labelledby={'career-responses-tab-' + section}
            tabIndex={active ? 0 : -1}
            hidden={!active}
          >
            {active ? (
              <WorkspacePanelContent
                section={section}
                props={props}
                workspace={workspace}
                tableView={tableView}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

interface WorkspaceQueryActionsInput {
  readonly state: UseApplications;
  readonly workspace: WorkspaceController;
}

function renderTableView({ state, workspace }: WorkspaceQueryActionsInput) {
  const visibleApplications = workspace.filteredApplications.slice(0, workspace.tableLimit);
  return (
    <ResponsesApplicationsTable
      applications={visibleApplications}
      selectedIds={workspace.selectedIds}
      onToggleSelected={workspace.toggleSelected}
      onToggleAll={() => workspace.toggleAllVisible(visibleApplications)}
      onSelectAllFiltered={workspace.toggleAllFiltered}
      onClearSelection={workspace.clearSelection}
      allSelectedByFilter={workspace.allSelectedByFilter}
      allowSelectAllFiltered={!workspace.search.trim() && !workspace.actionOnly}
      pageMeta={filteredPageMeta(state.pageMeta, workspace.filteredApplications.length)}
      query={workspace.query}
      onBulkComplete={workspace.bulkComplete}
      selectedApplicationId={workspace.selectedApplication?.id}
      onSelectApplication={workspace.selectApplication}
    />
  );
}

function FunnelWorkspace({
  props,
  workspace,
  tableView,
}: {
  readonly props: ResponsesWorkspaceScreenProps;
  readonly workspace: WorkspaceController;
  readonly tableView: ReactNode;
}) {
  return (
    <>
      <FunnelControls state={props.state} workspace={workspace} />
      <FunnelResults props={props} workspace={workspace} tableView={tableView} />
    </>
  );
}

function FunnelControls({
  state,
  workspace,
}: {
  readonly state: UseApplications;
  readonly workspace: WorkspaceController;
}) {
  return (
    <>
      <ResponsesFunnelSummary
        counts={workspace.stageCounts}
        needsActionCount={workspace.needsActionCount}
        actionCountLoading={workspace.poolStatus !== 'ready'}
        onFilter={workspace.applySummaryFilter}
      />
      <ResponsesFilterControls
        applications={state.applications}
        query={workspace.query}
        search={workspace.search}
        sortMode={workspace.sortMode}
        period={workspace.period}
        onSearchChange={workspace.setSearch}
        onQueryChange={workspace.applyQuery}
        onSortChange={workspace.setSortMode}
        onPeriodChange={workspace.changePeriod}
        view={workspace.view}
        onViewChange={workspace.setView}
      />
    </>
  );
}

function FunnelResults({
  props,
  workspace,
  tableView,
}: {
  readonly props: ResponsesWorkspaceScreenProps;
  readonly workspace: WorkspaceController;
  readonly tableView: ReactNode;
}) {
  const applications = workspace.filteredApplications;
  const pendingApprovalCount = usePendingAutomationApprovalCount();
  return (
    <>
      <PoolStatusMessage workspace={workspace} />
      <ResponsesAutomationLink
        count={pendingApprovalCount}
        onOpenAutomation={props.onOpenAutomation}
      />
      <ResponsesMobileFeed
        applications={applications}
        allApplications={props.state.applications}
        visibleLimit={workspace.mobileListLimit}
        onLoadMore={workspace.loadMoreMobileList}
        onSelectApplication={workspace.selectApplication}
        onRefreshApplications={props.state.refreshApplications}
      />
      <FunnelBodyContent
        props={props}
        workspace={workspace}
        applications={applications}
        tableView={tableView}
      />
      <TablePagination workspace={workspace} applicationCount={applications.length} />
      {workspace.selectedApplication ? (
        <SelectedResponsePanel
          application={workspace.selectedApplication}
          onOpenExpert={props.onOpenExpert}
          onMarkFollowUpSent={() => props.state.markFollowUpSent(workspace.selectedApplication!.id)}
        />
      ) : null}
      <ResponsesChannelPerformance applications={applications} query={workspace.query} />
      <ResponsesPipelineAnalytics query={workspace.query} revision={props.state.applications} initiallyExpanded={props.initialTab === 'analytics'} onOpenVacancies={props.onOpenVacancies} onOpenExpert={props.onOpenExpert} />
    </>
  );
}

function PoolStatusMessage({ workspace }: { readonly workspace: WorkspaceController }) {
  if (workspace.poolStatus === 'loading') {
    return (
      <p className="career-responses-pool-status" role="status" aria-busy="true">
        Загружаем отклики для сводки и поиска.
      </p>
    );
  }
  if (workspace.poolStatus === 'error') {
    return (
      <p className="career-responses-pool-error" role="alert">
        {workspace.poolError}
        <button type="button" onClick={workspace.retryPool}>
          Повторить
        </button>
      </p>
    );
  }
  return null;
}

function FunnelBodyContent({
  props,
  workspace,
  applications,
  tableView,
}: {
  readonly props: ResponsesWorkspaceScreenProps;
  readonly workspace: WorkspaceController;
  readonly applications: readonly ApplicationView[];
  readonly tableView: ReactNode;
}) {
  if (applications.length === 0) {
    const filtered = hasActiveResponseFilters(workspace);
    return filtered ? (
      <NoResponsesResults
        filtered={true}
        onReset={workspace.resetFilters}
        onOpenVacancies={props.onOpenVacancies}
      />
    ) : (
      props.emptyContent
    );
  }
  if (workspace.view === 'table') return tableView;
  return props.columnsContent({
    applications,
    selectedId: workspace.selectedApplication?.id,
    onSelectApplication: workspace.selectApplication,
    visibleCounts: workspace.columnLimits,
    onLoadMore: workspace.loadMoreColumn,
    onSwitchToTable: () => workspace.setView('table'),
    onClearFilter: () => workspace.applyQuery({ stage: OPEN_APPLICATION_STAGES }),
  });
}

function hasActiveResponseFilters(workspace: WorkspaceController): boolean {
  const hasStageFilter =
    JSON.stringify(workspace.query.stage ?? []) !== JSON.stringify(OPEN_APPLICATION_STAGES);
  return Boolean(
    workspace.search.trim() ||
    workspace.actionOnly ||
    workspace.query.channel?.length ||
    hasStageFilter,
  );
}

function TablePagination({
  workspace,
  applicationCount,
}: {
  readonly workspace: WorkspaceController;
  readonly applicationCount: number;
}) {
  if (workspace.view !== 'table' || applicationCount <= workspace.tableLimit) return null;
  return (
    <button
      type="button"
      className="career-btn career-btn-secondary career-btn-sm"
      onClick={workspace.loadMoreTable}
    >
      Показать ещё 20
    </button>
  );
}

function NoResponsesResults({
  filtered,
  onReset,
  onOpenVacancies,
}: {
  readonly filtered: boolean;
  readonly onReset: () => void;
  readonly onOpenVacancies: () => void;
}) {
  return (
    <section className="career-responses-empty" role="status">
      <h2>{filtered ? 'Отклики не найдены' : 'Откликов за этот период нет'}</h2>
      <p>
        {filtered
          ? 'Измените запрос или сбросьте фильтры, чтобы увидеть другие отклики.'
          : 'Когда появятся отклики, здесь будут их этапы и следующие шаги.'}
      </p>
      <div className="career-responses-empty-actions">
        {filtered ? (
          <button
            type="button"
            className="career-btn career-btn-secondary career-btn-sm"
            onClick={onReset}
          >
            Сбросить фильтры
          </button>
        ) : null}
        <button
          type="button"
          className="career-btn career-btn-primary career-btn-sm"
          onClick={onOpenVacancies}
        >
          Перейти к вакансиям
        </button>
      </div>
    </section>
  );
}

function filteredPageMeta(
  pageMeta: ApplicationListPageMeta | undefined,
  total: number,
): ApplicationListPageMeta | undefined {
  return pageMeta ? { ...pageMeta, total, offset: 0, limit: Math.min(20, total) } : undefined;
}
