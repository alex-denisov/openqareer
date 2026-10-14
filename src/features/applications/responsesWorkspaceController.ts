import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ApplicationStage } from '../../../shared/applicationStage';
import type { ApplicationListQuery, ApplicationView } from './applicationsApi';
import type {
  ResponsesPeriod,
  ResponsesSummaryFilter,
  ResponsesViewMode,
  ResponsesWorkspaceSection,
} from './ResponsesWorkspaceControls';
import type { ResponsesSortMode as SortMode } from './responsesFiltering';
import {
  countResponseStages,
  countResponsesNeedingAction,
  filterResponseCohort,
  filterResponsesForQuery,
  lastDaysRange,
} from './responsesFiltering';
import type { UseApplications } from './useApplications';

export interface WorkspaceControllerProps {
  readonly state: UseApplications;
  readonly stageFilter?: ApplicationStage | null;
  readonly onStageFilterChange: (stage: ApplicationStage | null) => void;
  readonly onClearFilter?: () => void;
  readonly initialTab?: 'board' | 'analytics';
}

export const OPEN_APPLICATION_STAGES: readonly ApplicationStage[] = [
  'saved',
  'applied',
  'responded',
  'interview',
  'offer',
];

const DEFAULT_COLUMN_LIMITS = {
  sent: 4,
  responded: 4,
  interview: 4,
  offer: 4,
};

export interface WorkspaceController {
  readonly section: ResponsesWorkspaceSection;
  readonly setSection: (section: ResponsesWorkspaceSection) => void;
  readonly view: ResponsesViewMode;
  readonly setView: (view: ResponsesViewMode) => void;
  readonly query: ApplicationListQuery;
  readonly period: ResponsesPeriod;
  readonly search: string;
  readonly sortMode: SortMode;
  readonly actionOnly: boolean;
  readonly filteredApplications: readonly ApplicationView[];
  readonly selectedApplication?: ApplicationView;
  readonly selectApplication: (id: string) => void;
  readonly selectedIds: ReadonlySet<string>;
  readonly allSelectedByFilter: boolean;
  readonly tableLimit: number;
  readonly mobileListLimit: number;
  readonly columnLimits: Readonly<Record<string, number>>;
  readonly poolStatus: 'loading' | 'ready' | 'error';
  readonly poolError: string;
  readonly needsActionCount: number;
  readonly stageCounts: Record<ApplicationStage, number>;
  readonly applyQuery: (query: ApplicationListQuery) => void;
  readonly applySummaryFilter: (filter: ResponsesSummaryFilter) => void;
  readonly setSearch: (search: string) => void;
  readonly setSortMode: (mode: SortMode) => void;
  readonly changePeriod: (period: ResponsesPeriod) => void;
  readonly resetFilters: () => void;
  readonly retryPool: () => void;
  readonly toggleSelected: (id: string) => void;
  readonly toggleAllVisible: (visible: readonly ApplicationView[]) => void;
  readonly toggleAllFiltered: () => void;
  readonly clearSelection: () => void;
  readonly loadMoreTable: () => void;
  readonly loadMoreMobileList: () => void;
  readonly loadMoreColumn: (column: string) => void;
  readonly bulkComplete: () => void;
}

export function useWorkspaceController(props: WorkspaceControllerProps): WorkspaceController {
  const selection = useWorkspaceSelection();
  const pagination = useWorkspacePagination();
  const { resetPagination } = pagination;
  const { clearSelection } = selection;
  const resetPages = useCallback(() => {
    resetPagination();
    clearSelection();
  }, [resetPagination, clearSelection]);
  const filters = useWorkspaceFilters(props, resetPages, resetPagination);
  const pool = useWorkspacePool(props.state, filters.query);
  const selectedApplication =
    filters.filteredApplications.find((application) => application.id === selection.selectedId) ??
    defaultSelectedApplication(filters.filteredApplications);
  const bulkComplete = useBulkComplete(props.state, clearSelection);
  return {
    ...filters,
    ...selection,
    ...pagination,
    ...pool,
    selectedApplication,
    bulkComplete,
  };
}

interface WorkspaceSelection {
  readonly selectedId?: string;
  readonly selectApplication: (id: string) => void;
  readonly selectedIds: ReadonlySet<string>;
  readonly allSelectedByFilter: boolean;
  readonly toggleSelected: (id: string) => void;
  readonly toggleAllVisible: (visible: readonly ApplicationView[]) => void;
  readonly toggleAllFiltered: () => void;
  readonly clearSelection: () => void;
}

function useWorkspaceSelection(): WorkspaceSelection {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [allSelectedByFilter, setAllSelectedByFilter] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const toggleSelected = useCallback((id: string) => {
    setAllSelectedByFilter(false);
    setSelectedIds((current) => toggleId(current, id));
  }, []);
  const toggleAllVisible = useCallback((visible: readonly ApplicationView[]) => {
    setAllSelectedByFilter(false);
    setSelectedIds((current) =>
      current.size === visible.length
        ? new Set()
        : new Set(visible.map((application) => application.id)),
    );
  }, []);
  const toggleAllFiltered = useCallback(() => setAllSelectedByFilter((current) => !current), []);
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setAllSelectedByFilter(false);
  }, []);
  return {
    selectedId,
    selectApplication: setSelectedId,
    selectedIds,
    allSelectedByFilter,
    toggleSelected,
    toggleAllVisible,
    toggleAllFiltered,
    clearSelection,
  };
}

interface WorkspacePagination {
  readonly tableLimit: number;
  readonly mobileListLimit: number;
  readonly columnLimits: Readonly<Record<string, number>>;
  readonly resetPagination: () => void;
  readonly loadMoreTable: () => void;
  readonly loadMoreMobileList: () => void;
  readonly loadMoreColumn: (column: string) => void;
}

function useWorkspacePagination(): WorkspacePagination {
  const [tableLimit, setTableLimit] = useState(20);
  const [mobileListLimit, setMobileListLimit] = useState(10);
  const [columnLimits, setColumnLimits] =
    useState<Readonly<Record<string, number>>>(DEFAULT_COLUMN_LIMITS);
  const resetPagination = useCallback(() => {
    setTableLimit(20);
    setMobileListLimit(10);
    setColumnLimits(DEFAULT_COLUMN_LIMITS);
  }, []);
  const loadMoreTable = useCallback(() => setTableLimit((current) => current + 20), []);
  const loadMoreMobileList = useCallback(() => setMobileListLimit((current) => current + 20), []);
  const loadMoreColumn = useCallback(
    (column: string) =>
      setColumnLimits((current) => ({ ...current, [column]: (current[column] ?? 4) + 20 })),
    [],
  );
  return {
    tableLimit,
    mobileListLimit,
    columnLimits,
    resetPagination,
    loadMoreTable,
    loadMoreMobileList,
    loadMoreColumn,
  };
}

interface WorkspaceFilters {
  readonly section: ResponsesWorkspaceSection;
  readonly setSection: (section: ResponsesWorkspaceSection) => void;
  readonly view: ResponsesViewMode;
  readonly setView: (view: ResponsesViewMode) => void;
  readonly query: ApplicationListQuery;
  readonly period: ResponsesPeriod;
  readonly search: string;
  readonly sortMode: SortMode;
  readonly actionOnly: boolean;
  readonly filteredApplications: readonly ApplicationView[];
  readonly stageCounts: Record<ApplicationStage, number>;
  readonly needsActionCount: number;
  readonly applyQuery: (query: ApplicationListQuery) => void;
  readonly applySummaryFilter: (filter: ResponsesSummaryFilter) => void;
  readonly setSearch: (search: string) => void;
  readonly setSortMode: (mode: SortMode) => void;
  readonly changePeriod: (period: ResponsesPeriod) => void;
  readonly resetFilters: () => void;
}

function useWorkspaceFilters(
  props: WorkspaceControllerProps,
  resetPages: () => void,
  resetPagination: () => void,
): WorkspaceFilters {
  const [section, setSection] = useState<ResponsesWorkspaceSection>('funnel');
  const [view, setView] = useState<ResponsesViewMode>(
    props.initialTab === 'analytics' ? 'table' : 'columns',
  );
  const [period, setPeriod] = useState<ResponsesPeriod>('30');
  const [search, setSearchState] = useState('');
  const [sortMode, setSortModeState] = useState<SortMode>('step');
  const [actionOnly, setActionOnly] = useState(false);
  const [query, setQuery] = useState<ApplicationListQuery>(() => ({
    stage: props.stageFilter ? [props.stageFilter] : OPEN_APPLICATION_STAGES,
    ...lastDaysRange(30),
    limit: 20,
    offset: 0,
  }));
  const applications = props.state.applications;
  useStageFilterSync(props.stageFilter, setQuery);
  const data = useResponseFilterData(applications, query, search, actionOnly, sortMode);
  const queryActions = useWorkspaceQueryActions({
    props,
    query,
    setQuery,
    setView,
    setActionOnly,
    setPeriod,
    setSearchState,
    setSortModeState,
    resetPages,
    resetPagination,
  });
  return {
    section,
    setSection,
    view,
    setView,
    query,
    period,
    search,
    sortMode,
    actionOnly,
    ...data,
    ...queryActions,
  };
}

function useStageFilterSync(
  stageFilter: ApplicationStage | null | undefined,
  setQuery: (update: (query: ApplicationListQuery) => ApplicationListQuery) => void,
) {
  useEffect(() => {
    if (!stageFilter) return;
    setQuery((current) =>
      current.stage?.length === 1 && current.stage[0] === stageFilter
        ? current
        : { ...current, stage: [stageFilter], offset: 0 },
    );
  }, [setQuery, stageFilter]);
}

function useResponseFilterData(
  applications: readonly ApplicationView[],
  query: ApplicationListQuery,
  search: string,
  actionOnly: boolean,
  sortMode: SortMode,
) {
  const cohort = useMemo(() => filterResponseCohort(applications, query), [applications, query]);
  const stageCounts = useMemo(() => countResponseStages(cohort), [cohort]);
  const filteredApplications = useMemo(
    () => filterResponsesForQuery(applications, query, search, actionOnly, sortMode),
    [applications, query, search, actionOnly, sortMode],
  );
  const needsActionCount = useMemo(() => countResponsesNeedingAction(cohort), [cohort]);
  return { filteredApplications, stageCounts, needsActionCount };
}

function useWorkspaceQueryActions({
  props,
  query,
  setQuery,
  setView,
  setActionOnly,
  setPeriod,
  setSearchState,
  setSortModeState,
  resetPages,
  resetPagination,
}: {
  readonly props: WorkspaceControllerProps;
  readonly query: ApplicationListQuery;
  readonly setQuery: Dispatch<SetStateAction<ApplicationListQuery>>;
  readonly setView: (view: ResponsesViewMode) => void;
  readonly setActionOnly: (actionOnly: boolean) => void;
  readonly setPeriod: (period: ResponsesPeriod) => void;
  readonly setSearchState: (search: string) => void;
  readonly setSortModeState: (mode: SortMode) => void;
  readonly resetPages: () => void;
  readonly resetPagination: () => void;
}) {
  const { onClearFilter, onStageFilterChange } = props;
  const applyQuery = useApplyQueryAction({
    setQuery,
    setActionOnly,
    resetPages,
    onClearFilter,
    onStageFilterChange,
  });
  const applySummaryFilter = useWorkspaceSummaryFilter({
    props,
    setQuery,
    setView,
    setActionOnly,
    resetPages,
  });
  const inputActions = useWorkspaceInputActions({
    query,
    applyQuery,
    setPeriod,
    setSearchState,
    setSortModeState,
    setActionOnly,
    resetPages,
    resetPagination,
  });
  return { applyQuery, applySummaryFilter, ...inputActions };
}

function useWorkspaceSummaryFilter({
  props,
  setQuery,
  setView,
  setActionOnly,
  resetPages,
}: {
  readonly props: WorkspaceControllerProps;
  readonly setQuery: Dispatch<SetStateAction<ApplicationListQuery>>;
  readonly setView: (view: ResponsesViewMode) => void;
  readonly setActionOnly: (actionOnly: boolean) => void;
  readonly resetPages: () => void;
}) {
  return useSummaryFilterAction({
    setQuery,
    setView,
    setActionOnly,
    resetPages,
    onClearFilter: props.onClearFilter,
    onStageFilterChange: props.onStageFilterChange,
  });
}

function useApplyQueryAction({
  setQuery,
  setActionOnly,
  resetPages,
  onClearFilter,
  onStageFilterChange,
}: {
  readonly setQuery: Dispatch<SetStateAction<ApplicationListQuery>>;
  readonly setActionOnly: (actionOnly: boolean) => void;
  readonly resetPages: () => void;
  readonly onClearFilter?: () => void;
  readonly onStageFilterChange: (stage: ApplicationStage | null) => void;
}) {
  return useCallback(
    (next: ApplicationListQuery) => {
      setQuery((current) => ({ ...current, ...next, limit: 20, offset: 0 }));
      if (Object.prototype.hasOwnProperty.call(next, 'stage')) setActionOnly(false);
      resetPages();
      if (Object.prototype.hasOwnProperty.call(next, 'stage')) {
        if (next.stage?.length === 1) onStageFilterChange(next.stage[0]);
        else onClearFilter?.();
      }
    },
    [onClearFilter, onStageFilterChange, resetPages, setActionOnly, setQuery],
  );
}

function useWorkspaceInputActions({
  query,
  applyQuery,
  setPeriod,
  setSearchState,
  setSortModeState,
  setActionOnly,
  resetPages,
  resetPagination,
}: {
  readonly query: ApplicationListQuery;
  readonly applyQuery: (query: ApplicationListQuery) => void;
  readonly setPeriod: (period: ResponsesPeriod) => void;
  readonly setSearchState: (search: string) => void;
  readonly setSortModeState: (mode: SortMode) => void;
  readonly setActionOnly: (actionOnly: boolean) => void;
  readonly resetPages: () => void;
  readonly resetPagination: () => void;
}) {
  const setSearch = useSearchAction(setSearchState, resetPages);
  const setSortMode = useSortAction(setSortModeState, resetPagination);
  const periodActions = usePeriodActions({
    query,
    applyQuery,
    setPeriod,
    setSearchState,
    setSortModeState,
    setActionOnly,
  });
  return { setSearch, setSortMode, ...periodActions };
}

function useSummaryFilterAction({
  setQuery,
  setView,
  setActionOnly,
  resetPages,
  onClearFilter,
  onStageFilterChange,
}: {
  readonly setQuery: Dispatch<SetStateAction<ApplicationListQuery>>;
  readonly setView: (view: ResponsesViewMode) => void;
  readonly setActionOnly: (actionOnly: boolean) => void;
  readonly resetPages: () => void;
  readonly onClearFilter?: () => void;
  readonly onStageFilterChange: (stage: ApplicationStage | null) => void;
}) {
  return useCallback(
    (filter: ResponsesSummaryFilter) => {
      setQuery((current) => ({ ...current, stage: filter.stage, limit: 20, offset: 0 }));
      setActionOnly(Boolean(filter.actionOnly));
      setView(
        filter.stage.some((stage) => stage === 'rejected' || stage === 'archived')
          ? 'table'
          : 'columns',
      );
      resetPages();
      if (!filter.actionOnly && filter.stage.length === 1) {
        onStageFilterChange(filter.stage[0]);
      } else {
        onClearFilter?.();
      }
    },
    [onClearFilter, onStageFilterChange, resetPages, setActionOnly, setQuery, setView],
  );
}

function useSearchAction(setSearchState: (search: string) => void, resetPages: () => void) {
  return useCallback(
    (value: string) => {
      setSearchState(value);
      resetPages();
    },
    [resetPages, setSearchState],
  );
}

function useSortAction(setSortModeState: (mode: SortMode) => void, resetPagination: () => void) {
  return useCallback(
    (mode: SortMode) => {
      setSortModeState(mode);
      resetPagination();
    },
    [resetPagination, setSortModeState],
  );
}

function usePeriodActions({
  query,
  applyQuery,
  setPeriod,
  setSearchState,
  setSortModeState,
  setActionOnly,
}: {
  readonly query: ApplicationListQuery;
  readonly applyQuery: (query: ApplicationListQuery) => void;
  readonly setPeriod: (period: ResponsesPeriod) => void;
  readonly setSearchState: (search: string) => void;
  readonly setSortModeState: (mode: SortMode) => void;
  readonly setActionOnly: (actionOnly: boolean) => void;
}) {
  const changePeriod = useCallback(
    (nextPeriod: ResponsesPeriod) => {
      setPeriod(nextPeriod);
      applyQuery(
        nextPeriod === 'all'
          ? { from: undefined, to: undefined }
          : lastDaysRange(Number(nextPeriod)),
      );
    },
    [applyQuery, setPeriod],
  );
  const resetFilters = useCallback(() => {
    setSearchState('');
    setPeriod('30');
    setSortModeState('step');
    setActionOnly(false);
    applyQuery({
      ...query,
      stage: OPEN_APPLICATION_STAGES,
      channel: [],
      ...lastDaysRange(30),
    });
  }, [applyQuery, query, setActionOnly, setPeriod, setSearchState, setSortModeState]);
  return { changePeriod, resetFilters };
}

interface WorkspacePool {
  readonly poolStatus: 'loading' | 'ready' | 'error';
  readonly poolError: string;
  readonly retryPool: () => void;
}

function useWorkspacePool(state: UseApplications, query: ApplicationListQuery): WorkspacePool {
  const [poolStatus, setPoolStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [poolError, setPoolError] = useState('');
  const [poolRetryToken, setPoolRetryToken] = useState(0);
  const [loadedPoolKey, setLoadedPoolKey] = useState('');
  usePoolLoadEffect({
    state,
    query,
    poolRetryToken,
    loadedPoolKey,
    setLoadedPoolKey,
    setPoolStatus,
    setPoolError,
  });
  const retryPool = useCallback(() => setPoolRetryToken((current) => current + 1), []);
  return { poolStatus, poolError, retryPool };
}

function usePoolLoadEffect({
  state,
  query,
  poolRetryToken,
  loadedPoolKey,
  setLoadedPoolKey,
  setPoolStatus,
  setPoolError,
}: {
  readonly state: UseApplications;
  readonly query: ApplicationListQuery;
  readonly poolRetryToken: number;
  readonly loadedPoolKey: string;
  readonly setLoadedPoolKey: (key: string) => void;
  readonly setPoolStatus: (status: 'loading' | 'ready' | 'error') => void;
  readonly setPoolError: (error: string) => void;
}) {
  const { applications, pageMeta, loadPool } = state;
  const loadedCount = applications.length;
  const from = query.from;
  const to = query.to;
  const poolFilterKey = JSON.stringify([from ?? '', to ?? '']);
  useEffect(
    () =>
      runPoolLoadEffect({
        loadPool,
        pageMeta,
        loadedCount,
        loadedPoolKey,
        poolFilterKey,
        query: { from, to },
        setLoadedPoolKey,
        setPoolStatus,
        setPoolError,
      }),
    [
      loadPool,
      loadedCount,
      loadedPoolKey,
      pageMeta,
      poolFilterKey,
      poolRetryToken,
      from,
      to,
      setPoolError,
      setPoolStatus,
      setLoadedPoolKey,
    ],
  );
}

function runPoolLoadEffect({
  loadPool,
  pageMeta,
  loadedCount,
  loadedPoolKey,
  poolFilterKey,
  query,
  setLoadedPoolKey,
  setPoolStatus,
  setPoolError,
}: {
  readonly loadPool?: UseApplications['loadPool'];
  readonly pageMeta?: UseApplications['pageMeta'];
  readonly loadedCount: number;
  readonly loadedPoolKey: string;
  readonly poolFilterKey: string;
  readonly query: ApplicationListQuery;
  readonly setLoadedPoolKey: (key: string) => void;
  readonly setPoolStatus: (status: 'loading' | 'ready' | 'error') => void;
  readonly setPoolError: (error: string) => void;
}): (() => void) | undefined {
  if (!loadPool) {
    setPoolStatus('ready');
    return;
  }
  if (!pageMeta) return;
  if (loadedPoolKey === poolFilterKey && loadedCount >= pageMeta.total) {
    setPoolStatus('ready');
    return;
  }
  const controller = new AbortController();
  setPoolStatus('loading');
  setPoolError('');
  requestFullPool(
    loadPool,
    query,
    controller.signal,
    poolFilterKey,
    setLoadedPoolKey,
    setPoolStatus,
    setPoolError,
  );
  return () => controller.abort();
}

function requestFullPool(
  loadPool: NonNullable<UseApplications['loadPool']>,
  query: ApplicationListQuery,
  signal: AbortSignal,
  key: string,
  setLoadedPoolKey: (key: string) => void,
  setPoolStatus: (status: 'loading' | 'ready' | 'error') => void,
  setPoolError: (error: string) => void,
) {
  void loadPool({ stage: [], channel: [], from: query.from, to: query.to }, signal)
    .then(() => finishPoolLoad(signal, key, setLoadedPoolKey, setPoolStatus))
    .catch((reason: unknown) => failPoolLoad(reason, signal, setPoolError, setPoolStatus));
}

function finishPoolLoad(
  signal: AbortSignal,
  key: string,
  setLoadedPoolKey: (key: string) => void,
  setPoolStatus: (status: 'loading' | 'ready' | 'error') => void,
) {
  if (signal.aborted) return;
  setLoadedPoolKey(key);
  setPoolStatus('ready');
}

function failPoolLoad(
  reason: unknown,
  signal: AbortSignal,
  setPoolError: (error: string) => void,
  setPoolStatus: (status: 'loading' | 'ready' | 'error') => void,
) {
  if (signal.aborted) return;
  setPoolError(
    reason instanceof Error ? reason.message : 'Не удалось загрузить отклики для поиска.',
  );
  setPoolStatus('error');
}

function useBulkComplete(state: UseApplications, clearSelection: () => void) {
  return useCallback(() => {
    clearSelection();
    void state.refreshApplications().catch(() => undefined);
  }, [clearSelection, state]);
}

function defaultSelectedApplication(
  applications: readonly ApplicationView[],
): ApplicationView | undefined {
  return (
    applications.find((application) => application.stage === 'interview') ??
    applications.find((application) => application.whoseTurn === 'candidate') ??
    applications[0]
  );
}

function toggleId(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
