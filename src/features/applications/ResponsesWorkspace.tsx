import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ReactNode } from 'react';
import type { ApplicationStage } from '../../../shared/applicationStage';
import { APPLICATION_STAGES } from '../../../shared/applicationStage';
import type {
  ApplicationListPageMeta,
  ApplicationListQuery,
  ApplicationView,
} from './applicationsApi';

import type { UseApplications } from './useApplications';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { ResponsesApplicationsTable } from './ResponsesApplicationsTable';
import { CandidateActionPanel } from './CandidateActionPanel';
import { ResponsesOffersPanel } from './ResponsesOffersPanel';
import { CompanyWantsPanel } from './ResponsesCompanyWants';
import './responses-workspace.css';

export type ResponsesWorkspaceSection = 'funnel' | 'company-wants' | 'offers' | 'automation';
export type ResponsesViewMode = 'columns' | 'table';

export interface ResponsesWorkspaceScreenProps {
  readonly state: UseApplications;
  readonly stageFilter?: ApplicationStage | null;
  readonly onStageFilterChange: (stage: ApplicationStage | null) => void;
  readonly onClearFilter?: () => void;
  readonly onOpenVacancies: () => void;
  readonly initialTab?: 'board' | 'analytics';
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
  readonly columnsContent: ReactNode;
  readonly emptyContent: ReactNode;
  readonly analyticsContent: ReactNode;
}

interface WorkspaceController {
  readonly section: ResponsesWorkspaceSection;
  readonly setSection: (section: ResponsesWorkspaceSection) => void;
  readonly view: ResponsesViewMode;
  readonly setView: (view: ResponsesViewMode) => void;
  readonly query: ApplicationListQuery;
  readonly showClosed: boolean;
  readonly selectedIds: ReadonlySet<string>;
  readonly allSelectedByFilter: boolean;
  readonly channelsAnalyticsOpen: boolean;
  readonly setChannelsAnalyticsOpen: (open: (current: boolean) => boolean) => void;
  readonly applyQuery: (query: ApplicationListQuery) => void;
  readonly changeClosedVisibility: (show: boolean) => void;
  readonly toggleSelected: (id: string) => void;
  readonly toggleAllVisible: () => void;
  readonly toggleAllFiltered: () => void;
  readonly loadMore: () => void;
  readonly bulkComplete: () => void;
}

const OPEN_APPLICATION_STAGES: readonly ApplicationStage[] = [
  'saved',
  'applied',
  'responded',
  'interview',
  'offer',
];

export function ResponsesWorkspaceScreen(props: ResponsesWorkspaceScreenProps) {
  const workspace = useWorkspaceController(props);
  const tableView = renderTableView(props.state, workspace, props.onOpenExpert);
  return (
    <div className="career-responses-board-wrap">
      <ResponsesWorkspaceNavigation section={workspace.section} onChange={workspace.setSection} />
      {workspace.section === 'funnel' ? (
        <FunnelWorkspace props={props} workspace={workspace} tableView={tableView} />
      ) : workspace.section === 'company-wants' ? (
        <CompanyWantsPanel />
      ) : workspace.section === 'offers' ? (
        <ResponsesOffersPanel state={props.state} />
      ) : (
        <CandidateActionPanel
          applications={props.state.applications}
          onRefreshApplications={props.state.refreshApplications}
        />
      )}
    </div>
  );
}

function useWorkspaceController(props: ResponsesWorkspaceScreenProps): WorkspaceController {
  const { state: appState, stageFilter } = props;
  const [section, setSection] = useState<ResponsesWorkspaceSection>('funnel');
  const [view, setView] = useState<ResponsesViewMode>(
    props.initialTab === 'analytics' ? 'table' : 'columns',
  );
  const [query, setQuery] = useState<ApplicationListQuery>({
    stage: stageFilter ? [stageFilter] : OPEN_APPLICATION_STAGES,
    limit: 20,
    offset: 0,
  });
  const [showClosed, setShowClosed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [allSelectedByFilter, setAllSelectedByFilter] = useState(false);
  const [channelsAnalyticsOpen, setChannelsAnalyticsOpen] = useState(false);
  useEffect(() => {
    loadInitialStage(appState.loadPage, stageFilter);
  }, [appState.loadPage, stageFilter]);
  const queryActions = useWorkspaceQueryActions({
    appState,
    query,
    setQuery,
    setSelectedIds,
    setAllSelectedByFilter,
    setShowClosed,
    onStageFilterChange: props.onStageFilterChange,
    onClearFilter: props.onClearFilter,
  });
  const selectionActions = useWorkspaceSelectionActions({
    appState,
    query,
    applications: appState.applications,
    setSelectedIds,
    setAllSelectedByFilter,
  });
  return {
    section,
    setSection,
    view,
    setView,
    query,
    showClosed,
    selectedIds,
    allSelectedByFilter,
    channelsAnalyticsOpen,
    setChannelsAnalyticsOpen,
    ...queryActions,
    ...selectionActions,
  };
}

interface WorkspaceQueryActionsInput {
  readonly appState: UseApplications;
  readonly query: ApplicationListQuery;
  readonly setQuery: Dispatch<SetStateAction<ApplicationListQuery>>;
  readonly setSelectedIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  readonly setAllSelectedByFilter: Dispatch<SetStateAction<boolean>>;
  readonly setShowClosed: Dispatch<SetStateAction<boolean>>;
  readonly onStageFilterChange: ResponsesWorkspaceScreenProps['onStageFilterChange'];
  readonly onClearFilter?: ResponsesWorkspaceScreenProps['onClearFilter'];
}

function useWorkspaceQueryActions(input: WorkspaceQueryActionsInput) {
  const {
    appState,
    query,
    setQuery,
    setSelectedIds,
    setAllSelectedByFilter,
    setShowClosed,
    onStageFilterChange,
    onClearFilter,
  } = input;
  const applyQuery = useCallback(
    (next: ApplicationListQuery) =>
      applyWorkspaceQuery(
        appState.loadPage,
        next,
        setQuery,
        setSelectedIds,
        setAllSelectedByFilter,
        onStageFilterChange,
        onClearFilter,
      ),
    [
      appState.loadPage,
      onClearFilter,
      onStageFilterChange,
      setAllSelectedByFilter,
      setQuery,
      setSelectedIds,
    ],
  );
  const changeClosedVisibility = useCallback(
    (show: boolean) => {
      setShowClosed(show);
      applyQuery({ ...query, stage: show ? [] : OPEN_APPLICATION_STAGES, offset: 0 });
    },
    [applyQuery, query, setShowClosed],
  );
  return { applyQuery, changeClosedVisibility };
}

interface WorkspaceSelectionActionsInput {
  readonly appState: UseApplications;
  readonly query: ApplicationListQuery;
  readonly applications: readonly ApplicationView[];
  readonly setSelectedIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  readonly setAllSelectedByFilter: Dispatch<SetStateAction<boolean>>;
}

function useWorkspaceSelectionActions(input: WorkspaceSelectionActionsInput) {
  const { appState, query, applications, setSelectedIds, setAllSelectedByFilter } = input;
  const { loadPage, refreshApplications } = appState;
  const toggleSelected = useCallback(
    (id: string) => {
      setAllSelectedByFilter(false);
      setSelectedIds((current) => toggleId(current, id));
    },
    [setAllSelectedByFilter, setSelectedIds],
  );
  const toggleAllVisible = useCallback(() => {
    setAllSelectedByFilter(false);
    setSelectedIds((current) =>
      current.size === applications.length ? new Set() : new Set(applications.map((app) => app.id)),
    );
  }, [applications, setAllSelectedByFilter, setSelectedIds]);
  const toggleAllFiltered = useCallback(
    () => setAllSelectedByFilter((current) => !current),
    [setAllSelectedByFilter],
  );
  const loadMore = useCallback(() => {
    if (loadPage) {
      void loadPage({ ...query, offset: applications.length, limit: 20 }, true).catch(
        () => undefined,
      );
    }
  }, [applications.length, loadPage, query]);
  const bulkComplete = useCallback(() => {
    setSelectedIds(new Set());
    setAllSelectedByFilter(false);
    void refreshApplications().catch(() => undefined);
  }, [refreshApplications, setAllSelectedByFilter, setSelectedIds]);
  return { toggleSelected, toggleAllVisible, toggleAllFiltered, loadMore, bulkComplete };
}

function loadInitialStage(
  loadPage: UseApplications['loadPage'],
  stageFilter?: ApplicationStage | null,
) {
  if (stageFilter && loadPage)
    void loadPage({ stage: [stageFilter], limit: 20, offset: 0 }).catch(() => undefined);
}

function applyWorkspaceQuery(
  loadPage: UseApplications['loadPage'],
  query: ApplicationListQuery,
  setQuery: (query: ApplicationListQuery) => void,
  setSelectedIds: (ids: ReadonlySet<string>) => void,
  setAllSelectedByFilter: (selected: boolean) => void,
  onStageFilterChange: (stage: ApplicationStage | null) => void,
  onClearFilter?: () => void,
) {
  const request = { ...query, limit: 20, offset: 0 };
  setQuery(request);
  setSelectedIds(new Set());
  setAllSelectedByFilter(false);
  if (loadPage) void loadPage(request).catch(() => undefined);
  else if (request.stage?.length === 1) onStageFilterChange(request.stage[0]);
  else onClearFilter?.();
}

function toggleId(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function renderTableView(
  state: UseApplications,
  workspace: WorkspaceController,
  onOpenExpert?: (stage: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => void,
) {
  const applications = applicationsForQuery(state.applications, workspace.query);
  return (
    <ResponsesApplicationsTable
      applications={applications}
      state={state}
      selectedIds={workspace.selectedIds}
      onToggleSelected={workspace.toggleSelected}
      onToggleAll={workspace.toggleAllVisible}
      onSelectAllFiltered={workspace.toggleAllFiltered}
      allSelectedByFilter={workspace.allSelectedByFilter}
      pageMeta={state.pageMeta}
      query={workspace.query}
      onOpenAutomation={() => workspace.setSection('automation')}
      onBulkComplete={workspace.bulkComplete}
      onOpenExpert={onOpenExpert}
    />
  );
}

function applicationsForQuery(
  applications: readonly ApplicationView[],
  query: ApplicationListQuery,
): readonly ApplicationView[] {
  if (query.stage?.length === 1)
    return applications.filter((application) => application.stage === query.stage?.[0]);
  return applications;
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
        counts={state.pageMeta?.stageCounts}
        onFilter={workspace.applyQuery}
      />
      <div className="career-responses-toolbar">
        <ResponsesFilterControls
          applications={state.applications}
          query={workspace.query}
          pageMeta={state.pageMeta}
          showClosed={workspace.showClosed}
          onApply={workspace.applyQuery}
          onShowClosedChange={workspace.changeClosedVisibility}
        />
        <ResponsesViewSwitch view={workspace.view} onChange={workspace.setView} />
      </div>
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
  const content = workspace.channelsAnalyticsOpen ? (
    props.analyticsContent
  ) : workspace.view === 'table' ? (
    tableView
  ) : props.state.applications.length === 0 ? (
    props.emptyContent
  ) : (
    <div className="career-responses-columns-content">{props.columnsContent}</div>
  );
  return (
    <>
      {content}
      {props.state.pageMeta && props.state.applications.length < props.state.pageMeta.total ? (
        <button
          type="button"
          className="career-btn career-btn-secondary career-btn-sm"
          onClick={workspace.loadMore}
        >
          Показать ещё
        </button>
      ) : null}
      {workspace.selectedIds.size > 0 ? (
        <p className="career-responses-selected-note" role="status">
          Выбрано {workspace.selectedIds.size} откликов на этой странице.
        </p>
      ) : null}
      <ChannelAnalyticsToggle
        open={workspace.channelsAnalyticsOpen}
        onChange={workspace.setChannelsAnalyticsOpen}
      />
    </>
  );
}

function ChannelAnalyticsToggle({
  open,
  onChange,
}: {
  readonly open: boolean;
  readonly onChange: (open: (current: boolean) => boolean) => void;
}) {
  return (
    <button
      type="button"
      className="career-responses-analytics-link"
      onClick={() => onChange((current) => !current)}
    >
      {open ? 'Скрыть результативность по каналам' : 'Результативность по каналам'}
    </button>
  );
}

export function ResponsesFunnelSummary({
  counts,
  onFilter,
}: {
  readonly counts?: Record<ApplicationStage, number>;
  readonly onFilter: (query: ApplicationListQuery) => void;
}) {
  const items: readonly { label: string; count: number; stage: readonly ApplicationStage[] }[] = [
    { label: 'Нужно действие', count: counts?.saved ?? 0, stage: ['saved'] },
    { label: 'Ждут ответа', count: counts?.applied ?? 0, stage: ['applied'] },
    { label: 'Ответили', count: counts?.responded ?? 0, stage: ['responded'] },
    { label: 'Интервью', count: counts?.interview ?? 0, stage: ['interview'] },
    { label: 'Оффер', count: counts?.offer ?? 0, stage: ['offer'] },
    {
      label: 'Закрыто',
      count: (counts?.rejected ?? 0) + (counts?.archived ?? 0),
      stage: ['rejected', 'archived'],
    },
  ];
  return (
    <section className="career-responses-funnel-summary" aria-label="Сводка этапов">
      {items.map((item) => (
        <button
          type="button"
          key={item.label}
          onClick={() => onFilter({ stage: item.stage, limit: 20, offset: 0 })}
        >
          <span>{item.label}</span>
          <strong>{item.count.toLocaleString('ru-RU')}</strong>
        </button>
      ))}
    </section>
  );
}

export function ResponsesWorkspaceNavigation({
  section,
  onChange,
}: {
  readonly section: ResponsesWorkspaceSection;
  readonly onChange: (section: ResponsesWorkspaceSection) => void;
}) {
  const tabs: readonly [ResponsesWorkspaceSection, string][] = [
    ['funnel', 'Воронка'],
    ['company-wants', 'Хочу в компанию'],
    ['offers', 'Офферы'],
  ];
  return (
    <nav className="career-responses-workspace-nav" aria-label="Разделы откликов">
      <div className="career-responses-workspace-tabs" role="tablist" aria-label="Отклики">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={section === key}
            className={section === key ? 'is-active' : ''}
            onClick={() => onChange(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={`career-responses-automation-link${section === 'automation' ? ' is-active' : ''}`}
        aria-pressed={section === 'automation'}
        onClick={() => onChange(section === 'automation' ? 'funnel' : 'automation')}
      >
        Автоматизация
      </button>
    </nav>
  );
}

export function ResponsesViewSwitch({
  view,
  onChange,
}: {
  readonly view: ResponsesViewMode;
  readonly onChange: (view: ResponsesViewMode) => void;
}) {
  return (
    <div className="career-responses-view-switch" role="group" aria-label="Вид откликов">
      <button type="button" aria-pressed={view === 'columns'} onClick={() => onChange('columns')}>
        Колонки
      </button>
      <button type="button" aria-pressed={view === 'table'} onClick={() => onChange('table')}>
        Таблица
      </button>
    </div>
  );
}

export function ResponsesFilterControls({
  applications,
  query,
  pageMeta,
  showClosed,
  onApply,
  onShowClosedChange,
}: {
  readonly applications: readonly ApplicationView[];
  readonly query: ApplicationListQuery;
  readonly pageMeta?: ApplicationListPageMeta;
  readonly showClosed: boolean;
  readonly onApply: (query: ApplicationListQuery) => void;
  readonly onShowClosedChange: (show: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(query);
  useEffect(() => setDraft(query), [query]);
  return (
    <section className="career-responses-filterbar" aria-label="Фильтры откликов">
      <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        Фильтры {activeFilterCount(query)}
      </button>
      <label className="career-responses-closed-toggle">
        <input
          type="checkbox"
          checked={showClosed}
          onChange={(event) => onShowClosedChange(event.currentTarget.checked)}
        />
        <span>Показать закрытые</span>
      </label>
      {open ? (
        <FilterPanel
          draft={draft}
          channels={availableChannels(applications)}
          resultCount={pageMeta?.total ?? applications.length}
          setDraft={setDraft}
          onApply={onApply}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}

function FilterPanel({
  draft,
  channels,
  resultCount,
  setDraft,
  onApply,
  onClose,
}: {
  readonly draft: ApplicationListQuery;
  readonly channels: readonly string[];
  readonly resultCount: number;
  readonly setDraft: (query: ApplicationListQuery) => void;
  readonly onApply: (query: ApplicationListQuery) => void;
  readonly onClose: () => void;
}) {
  return (
    <div className="career-responses-filter-panel">
      <FilterFields draft={draft} channels={channels} onChange={setDraft} />
      <div className="career-responses-filter-actions">
        <button
          type="button"
          className="career-btn career-btn-secondary career-btn-sm"
          onClick={() => {
            const cleared = { ...draft, stage: [], offset: 0 };
            setDraft(cleared);
            onApply(cleared);
          }}
        >
          Сбросить этап
        </button>
        <button
          type="button"
          className="career-btn career-btn-primary career-btn-sm"
          onClick={() => {
            onApply({ ...draft, offset: 0, limit: 20 });
            onClose();
          }}
        >
          Показать {resultCount}
        </button>
      </div>
    </div>
  );
}

function FilterFields({
  draft,
  channels,
  onChange,
}: {
  readonly draft: ApplicationListQuery;
  readonly channels: readonly string[];
  readonly onChange: (query: ApplicationListQuery) => void;
}) {
  return (
    <div className="career-responses-filter-fields">
      <StageChannelFields draft={draft} channels={channels} onChange={onChange} />
      <DateSortFields draft={draft} onChange={onChange} />
    </div>
  );
}

function StageChannelFields({
  draft,
  channels,
  onChange,
}: {
  readonly draft: ApplicationListQuery;
  readonly channels: readonly string[];
  readonly onChange: (query: ApplicationListQuery) => void;
}) {
  return (
    <>
      <StageField draft={draft} onChange={onChange} />
      <ChannelField draft={draft} channels={channels} onChange={onChange} />
    </>
  );
}

function StageField({
  draft,
  onChange,
}: {
  readonly draft: ApplicationListQuery;
  readonly onChange: (query: ApplicationListQuery) => void;
}) {
  return (
    <label>
      Этап
      <select
        value={draft.stage?.length === 1 ? draft.stage[0] : ''}
        onChange={(event) =>
          onChange({
            ...draft,
            stage: event.currentTarget.value ? [event.currentTarget.value as ApplicationStage] : [],
            offset: 0,
          })
        }
      >
        <option value="">Все этапы</option>
        {APPLICATION_STAGES.map((stage) => (
          <option key={stage} value={stage}>
            {stageLabel(stage)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ChannelField({
  draft,
  channels,
  onChange,
}: {
  readonly draft: ApplicationListQuery;
  readonly channels: readonly string[];
  readonly onChange: (query: ApplicationListQuery) => void;
}) {
  return (
    <label>
      Канал
      <select
        value={draft.channel?.[0] ?? ''}
        onChange={(event) =>
          onChange({
            ...draft,
            channel: event.currentTarget.value ? [event.currentTarget.value] : [],
            offset: 0,
          })
        }
      >
        <option value="">Все источники</option>
        {channels.map((channel) => (
          <option key={channel} value={channel}>
            {channel}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateSortFields({
  draft,
  onChange,
}: {
  readonly draft: ApplicationListQuery;
  readonly onChange: (query: ApplicationListQuery) => void;
}) {
  return (
    <>
      <label>
        С даты
        <input
          type="date"
          value={draft.from ?? ''}
          onChange={(event) =>
            onChange({ ...draft, from: event.currentTarget.value || undefined, offset: 0 })
          }
        />
      </label>
      <label>
        По дату
        <input
          type="date"
          value={draft.to ?? ''}
          onChange={(event) =>
            onChange({ ...draft, to: event.currentTarget.value || undefined, offset: 0 })
          }
        />
      </label>
      <label>
        Сортировка
        <select
          value={`${draft.sort ?? 'date'}:${draft.direction ?? 'desc'}`}
          onChange={(event) => {
            const [sort, direction] = event.currentTarget.value.split(':') as [
              'date' | 'company' | 'stage',
              'asc' | 'desc',
            ];
            onChange({ ...draft, sort, direction, offset: 0 });
          }}
        >
          <option value="date:desc">Сначала новые</option>
          <option value="date:asc">Сначала старые</option>
          <option value="company:asc">По компании</option>
          <option value="stage:asc">По этапу</option>
        </select>
      </label>
    </>
  );
}

function availableChannels(applications: readonly ApplicationView[]): string[] {
  return Array.from(
    new Set(
      applications
        .map((application) => application.vacancy?.source)
        .filter((source): source is string => Boolean(source)),
    ),
  ).sort();
}

function activeFilterCount(query: ApplicationListQuery): number {
  return (
    Number(Boolean(query.stage?.length && query.stage.length !== 5)) +
    Number(Boolean(query.channel?.length)) +
    Number(Boolean(query.from)) +
    Number(Boolean(query.to))
  );
}

function stageLabel(stage: ApplicationStage): string {
  const labels: Record<ApplicationStage, string> = {
    saved: 'Хочу',
    applied: 'Пробовали отправить',
    responded: 'Ответили',
    interview: 'Интервью',
    offer: 'Оффер',
    rejected: 'Отказ',
    archived: 'Архив',
  };
  return labels[stage];
}
