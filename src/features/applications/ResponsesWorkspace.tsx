import type { ReactNode } from 'react';
import type { ApplicationStage } from '../../../shared/applicationStage';
import type { ApplicationListPageMeta, ApplicationView } from './applicationsApi';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { useState } from 'react';
import { ResponsesApplicationsTable } from './ResponsesApplicationsTable';
import { ResponsesMobileFeed, type ResponsesMobileSelection } from './ResponsesMobileFeed';
import {
  ResponsesMobileClosedContent,
  ResponsesMobilePush,
  useCompactResponses,
  type ResponsesMobilePushView,
} from './ResponsesMobilePush';
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
import { ResponseMockInterviewSuggestion } from './ResponseMockInterviewSuggestion';
import { ResponsesMobileChannels } from './ResponsesMobileChannels';
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
  /** At 390 the archive lives in the «Закрыто» push screen, so the deep link opens it. */
  readonly initialArchiveOpen?: boolean;
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
  const compact = useCompactResponses();
  const [pushState, setPush] = useState<ResponsesMobilePushView | null>(() =>
    initialPushView(props),
  );
  const push = compact ? pushState : null;
  const closePush = () => {
    const returnTo = push?.kind === 'response' ? push.id : null;
    setPush(null);
    window.requestAnimationFrame(() => {
      const row = returnTo
        ? document.querySelector<HTMLElement>(`[data-application-id="${CSS.escape(returnTo)}"]`)
        : null;
      row?.focus();
    });
  };
  const openPush = (view: ResponsesMobilePushView) => {
    if (view.kind === 'response') workspace.selectApplication(view.id);
    setPush(view);
  };
  return (
    <div className="career-responses-funnel-flow" data-mobile-push={push ? push.kind : undefined}>
      {push ? (
        <ResponsesMobilePush view={push} onBack={closePush}>
          <MobilePushContent view={push} props={props} workspace={workspace} />
        </ResponsesMobilePush>
      ) : null}
      <FunnelControls state={props.state} workspace={workspace} />
      <FunnelResults
        props={props}
        workspace={workspace}
        tableView={tableView}
        pushOpen={push !== null}
        onOpenPush={openPush}
      />
    </div>
  );
}

/** Push screens reuse the 1440 blocks so every function keeps one implementation. */
function MobilePushContent({
  view,
  props,
  workspace,
}: {
  readonly view: ResponsesMobilePushView;
  readonly props: ResponsesWorkspaceScreenProps;
  readonly workspace: WorkspaceController;
}) {
  // Макет 5 `proc`: the response panel already holds its groups (next step, materials,
  // delivery, «О компании») from real data; responses-mobile.css lays them out as lists.
  if (view.kind === 'response') return <SelectedResponse props={props} workspace={workspace} />;
  if (view.kind === 'channels') {
    return (
      <ResponsesMobileChannels
        applications={workspace.filteredApplications}
        explanation={<StageAnalytics props={props} workspace={workspace} />}
      />
    );
  }
  return <ResponsesMobileClosedContent state={props.state} />;
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
        active={{ stage: summaryStage(workspace.query.stage), actionOnly: workspace.actionOnly }}
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
        stageCounts={workspace.stageCounts}
        needsActionCount={workspace.needsActionCount}
        actionOnly={workspace.actionOnly}
        onSummaryFilter={workspace.applySummaryFilter}
      />
    </>
  );
}

function FunnelResults({
  props,
  workspace,
  tableView,
  pushOpen,
  onOpenPush,
}: {
  readonly props: ResponsesWorkspaceScreenProps;
  readonly workspace: WorkspaceController;
  readonly tableView: ReactNode;
  readonly pushOpen: boolean;
  readonly onOpenPush: (view: ResponsesMobilePushView) => void;
}) {
  const applications = workspace.filteredApplications;
  return (
    <>
      <PoolStatusMessage workspace={workspace} />
      <FunnelMobileFeed props={props} workspace={workspace} onOpenPush={onOpenPush} />
      {/* Publishes the consultant offer; stays mounted while a 390 push screen is open. */}
      <MockInterviewSuggestion workspace={workspace} />
      {/* The 390 push screen renders its own copies; never two in the DOM. */}
      {pushOpen ? null : (
        <>
          <FunnelBodyContent
            props={props}
            workspace={workspace}
            applications={applications}
            tableView={tableView}
          />
          <TablePagination workspace={workspace} applicationCount={applications.length} />
          <SelectedResponse props={props} workspace={workspace} />
          <ChannelPerformance props={props} workspace={workspace} applications={applications} />
        </>
      )}
    </>
  );
}

function ChannelPerformance({
  props,
  workspace,
  applications,
}: {
  readonly props: ResponsesWorkspaceScreenProps;
  readonly workspace: WorkspaceController;
  readonly applications: readonly ApplicationView[];
}) {
  return (
    <ResponsesChannelPerformance
      applications={applications}
      query={workspace.query}
      initiallyExplained={props.initialTab === 'analytics'}
      explanation={<StageAnalytics props={props} workspace={workspace} />}
    />
  );
}

function StageAnalytics({
  props,
  workspace,
}: {
  readonly props: ResponsesWorkspaceScreenProps;
  readonly workspace: WorkspaceController;
}) {
  return (
    <ResponsesPipelineAnalytics
      query={workspace.query}
      revision={props.state.applications}
      initiallyExpanded
      onOpenVacancies={props.onOpenVacancies}
      onOpenExpert={props.onOpenExpert}
    />
  );
}

function FunnelMobileFeed({
  props,
  workspace,
  onOpenPush,
}: {
  readonly props: ResponsesWorkspaceScreenProps;
  readonly workspace: WorkspaceController;
  readonly onOpenPush: (view: ResponsesMobilePushView) => void;
}) {
  const pendingApprovalCount = usePendingAutomationApprovalCount();
  return (
    <ResponsesMobileFeed
      applications={workspace.filteredApplications}
      allApplications={props.state.applications}
      visibleLimit={workspace.mobileListLimit}
      onLoadMore={workspace.loadMoreMobileList}
      onOpenApplication={(id) => onOpenPush({ kind: 'response', id })}
      onOpenChannels={() => onOpenPush({ kind: 'channels' })}
      onOpenClosed={() => onOpenPush({ kind: 'closed' })}
      onRefreshApplications={props.state.refreshApplications}
      selection={mobileSelection(workspace)}
      header={
        <ResponsesAutomationLink
          count={pendingApprovalCount}
          onOpenAutomation={props.onOpenAutomation}
        />
      }
    />
  );
}

function SelectedResponse({
  props,
  workspace,
}: {
  readonly props: ResponsesWorkspaceScreenProps;
  readonly workspace: WorkspaceController;
}) {
  const application = workspace.selectedApplication;
  if (!application) return null;
  return (
    <SelectedResponsePanel
      application={application}
      onOpenExpert={props.onOpenExpert}
      onMarkFollowUpSent={() => props.state.markFollowUpSent(application.id)}
      onChangeStage={(stage, occurredAt, receipt) =>
        props.state.changeStage(application.id, stage, occurredAt, receipt)
      }
      onScheduleInterview={(scheduledAt) =>
        props.state.scheduleInterview(application.id, scheduledAt)
      }
      onRefresh={props.state.reload}
      onSaveNote={(notes) => props.state.saveNote(application.id, notes)}
      onSkip={(reasonId) => void props.state.skip(application, reasonId)}
    />
  );
}

function mobileSelection(workspace: WorkspaceController): ResponsesMobileSelection {
  return {
    selectedIds: workspace.selectedIds,
    allSelectedByFilter: workspace.allSelectedByFilter,
    query: workspace.query,
    onToggleSelected: workspace.toggleSelected,
    onToggleAllFiltered: workspace.toggleAllFiltered,
    onClearSelection: workspace.clearSelection,
    onBulkComplete: workspace.bulkComplete,
  };
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
  if (workspace.view !== 'table' || applicationCount === 0) return null;
  const shown = Math.min(workspace.tableLimit, applicationCount);
  return (
    <div className="career-responses-table-footer">
      <span>
        Показано {shown.toLocaleString('ru-RU')} из {applicationCount.toLocaleString('ru-RU')}
      </span>
      {applicationCount > shown ? (
        <button
          type="button"
          className="career-btn career-btn-secondary career-btn-sm"
          onClick={workspace.loadMoreTable}
        >
          Показать ещё 20
        </button>
      ) : null}
    </div>
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

/** The default open-stage query is the «все» chip of the strip. */
function summaryStage(stage: readonly ApplicationStage[] | undefined): readonly ApplicationStage[] {
  if (!stage) return [];
  const open = new Set(OPEN_APPLICATION_STAGES);
  return stage.length === open.size && stage.every((value) => open.has(value)) ? [] : stage;
}

function MockInterviewSuggestion({ workspace }: { readonly workspace: WorkspaceController }) {
  return workspace.selectedApplication ? (
    <ResponseMockInterviewSuggestion
      key={workspace.selectedApplication.id}
      application={workspace.selectedApplication}
    />
  ) : null;
}

function initialPushView(props: ResponsesWorkspaceScreenProps): ResponsesMobilePushView | null {
  if (props.initialApplicationId) return { kind: 'response', id: props.initialApplicationId };
  return props.initialArchiveOpen ? { kind: 'closed' } : null;
}
