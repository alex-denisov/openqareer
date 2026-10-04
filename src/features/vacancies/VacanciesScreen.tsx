import type { MatchedVacancyFacets } from '../../../shared/matchedVacancyFacets';
import { useEffect, useMemo, useState } from 'react';
import { Check, Info, List, MagnifyingGlass, MapTrifold, Warning } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { CampaignMetaView } from '../coach/matchedVacancyApi';
import type { ApplicationView } from '../applications/applicationsApi';
import type { VacancyApplicationSnapshot } from '../../../shared/vacancyApplication';
import type { VacancySubscription, CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { DesktopOutreachModal } from '../outreach/DesktopOutreachModal';
import { titleMatchesRole } from '../../../shared/vacancyRoleTitleMatch';
import { VacancyRow } from './VacancyRow';
import type { VacancyProfileRequirement } from './vacancyProfileRequirement';
import { VacancyHypothesisBanner } from './VacancyHypothesisBanner';
import { useVacancyCampaignActions } from './useVacancyCampaignActions';
import { CareerPathIndicator } from '../shell/CareerPathIndicator';
import { PageHeader } from '../shell/PageHeader';
import type { NavigationOptions, PathDestination, PathStep } from '../shell/pathIndicator';
import type { VacancyApplications } from './useVacancyApplications';
import { CANDIDATE_REGION_CATALOGUE } from '../workspace/candidateRegions';
import { pluralRu } from '../../../shared/pluralRu';
import { VacancyMapView } from './VacancyMapView';
import { SavedSearchesPanel } from './SavedSearchesPanel';
import { VacanciesFilters, type VacanciesScreenState } from './VacanciesScreenFilters';
import { CareerTooltip } from '../shell/CareerTooltip';
import { matchesVacancyCity } from './vacancyFacets';

import type { RoutePremisesDraft } from '../cabinet/routePremises';

export interface VacanciesPathIndicator {
  readonly steps: readonly PathStep[];
  readonly onNavigate: (destination: PathDestination, options?: NavigationOptions) => void;
}

export interface VacanciesScreenProps {
  readonly facets?: MatchedVacancyFacets;
  /** `false` — подборка прочитана не целиком: счётчик говорит «Загружено». */
  readonly poolComplete?: boolean;
  readonly onFiltersChange?: (state: VacanciesScreenState) => void;
  readonly matched: readonly MatchedVacancyItem[];
  readonly total: number;
  readonly campaign?: CampaignMetaView;
  readonly candidateLevel?: string | null;
  readonly loading?: boolean;
  readonly failed?: boolean;
  readonly failureSourceLabel?: string;
  readonly onRetry?: () => void;
  readonly now?: string;
  readonly pathIndicator?: VacanciesPathIndicator;
  readonly applications?: VacancyApplications;
  readonly archivedApplicationClusterIds?: ReadonlySet<string>;
  readonly onMarkAlreadyApplied?: (
    clusterId: string,
    vacancy: VacancyApplicationSnapshot,
  ) => Promise<void>;
  readonly onScheduleInterview?: (
    clusterId: string,
    scheduledAt: string,
    vacancy: VacancyApplicationSnapshot,
  ) => Promise<ApplicationView>;
  readonly onOpenResponses?: () => void;
  readonly onOpenArchive?: () => void;
  readonly onOpenProfile?: (context: VacancyProfileRequirement) => void;
  readonly onOpenNetworking?: (vacancy: MatchedVacancyItem['cluster']) => void;
  readonly onOpenExpert?: (stage: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => void;
  readonly subscriptions?: readonly VacancySubscription[];
  readonly onRefreshSubscriptions?: () => Promise<void>;
  readonly premises?: RoutePremisesDraft;
  readonly premisesLoading?: boolean;
  readonly onSavePremises?: (draft: RoutePremisesDraft) => Promise<void>;
  readonly focusRoleFilter?: boolean;
}

function extractBoardRegions(campaign?: CampaignMetaView) {
  const isProfile = campaign?.regions.origin === 'profile';
  return {
    roles: campaign?.roles.value ?? [],
    regions: isProfile ? [] : (campaign?.regions.value ?? []),
    suggestedRegions: campaign?.suggestedRegions?.length
      ? campaign.suggestedRegions
      : isProfile
        ? (campaign?.regions.value ?? [])
        : [],
  };
}

function initialSelectedId(matched: readonly MatchedVacancyItem[]): string | undefined {
  if (typeof window !== 'undefined' && window.innerWidth > 640) {
    return matched[0]?.cluster.id;
  }
  return undefined;
}

function useVacanciesScreenBoard(
  matched: readonly MatchedVacancyItem[],
  campaign: CampaignMetaView | undefined,
  now: string,
  onFiltersChange?: VacanciesScreenProps['onFiltersChange'],
) {
  const { roles, regions, suggestedRegions } = extractBoardRegions(campaign);
  const [state, setState] = useState<VacanciesScreenState>({
    roles: [],
    regions: [],
    levels: [],
    sources: [],
    remoteOnly: false,
  });
  // `undefined` — nothing chosen yet, so the default vacancy opens once the
  // pool arrives; `null` — the candidate collapsed the row and wants none open
  // (B324: collapsing used to reopen the default vacancy).
  const [selectedId, setSelectedId] = useState<string | null | undefined>(() =>
    initialSelectedId(matched),
  );

  useEffect(() => {
    if (selectedId === undefined && matched.length > 0) {
      setSelectedId(initialSelectedId(matched));
    }
  }, [matched, selectedId]);

  useEffect(() => {
    onFiltersChange?.(state);
  }, [state, onFiltersChange]);

  const filtered = useMemo(
    () =>
      filterByScreenState(
        matched,
        onFiltersChange ? { ...state, roles: [], regions: [], remoteOnly: false } : state,
        now,
      ),
    [matched, state, now, onFiltersChange],
  );

  return {
    roles,
    regions,
    suggestedRegions,
    state,
    setState,
    filtered,
    selectedId,
    setSelectedId,
    toggleSelect: (id: string) => {
      setSelectedId((prev) => (prev === id ? null : id));
    },
    roleHypotheses: campaign?.roleHypotheses ?? [],
    primaryRole: state.roles[0] ?? roles[0],
  };
}

function ViewSwitch({
  viewMode,
  onChange,
}: {
  readonly viewMode: 'list' | 'map';
  readonly onChange: (mode: 'list' | 'map') => void;
}) {
  return (
    <div className="view-switch" role="tablist" aria-label="Режим просмотра">
      <button
        type="button"
        className={viewMode === 'list' ? 'is-active' : ''}
        role="tab"
        aria-selected={viewMode === 'list'}
        onClick={() => onChange('list')}
      >
        <List size={16} aria-hidden="true" />
        <span>Список</span>
      </button>
      <button
        type="button"
        className={viewMode === 'map' ? 'is-active' : ''}
        role="tab"
        aria-selected={viewMode === 'map'}
        onClick={() => onChange('map')}
      >
        <MapTrifold size={16} aria-hidden="true" />
        <span>Карта</span>
      </button>
    </div>
  );
}

function VacanciesSkeletonStack() {
  return (
    <div className="skeleton-stack" aria-live="polite" aria-busy="true">
      <p className="list-hint">Загружаем подборку по кампании…</p>
      <div className="skeleton-row" />
      <div className="skeleton-row" />
      <div className="skeleton-row" />
      <div className="skeleton-row" />
    </div>
  );
}

function VacanciesErrorState({
  failureSourceLabel,
  onRetry,
}: {
  readonly failureSourceLabel?: string;
  readonly onRetry?: () => void;
}) {
  return (
    <div className="state-panel is-error vacancies-state" role="alert">
      <span className="state-icon" aria-hidden="true">
        <Warning size={20} />
      </span>
      <h3>Не удалось загрузить подборку</h3>
      <p>
        Не удалось загрузить общий пул вакансий.{' '}
        {failureSourceLabel ?? 'Площадка hh.ru не ответила.'} Роль и география сохранены.
      </p>
      {onRetry ? (
        <button type="button" className="btn btn-secondary vacancies-btn" onClick={onRetry}>
          Повторить
        </button>
      ) : null}
    </div>
  );
}

function VacanciesEmptyPoolState({
  primaryRole,
  onRetry,
}: {
  readonly primaryRole?: string;
  readonly onRetry?: () => void;
}) {
  return (
    <div className="state-panel vacancies-state">
      <span className="state-icon" aria-hidden="true">
        <MagnifyingGlass size={20} />
      </span>
      <h3>
        {primaryRole ? `По роли ${primaryRole} пока нет вакансий` : 'Для подбора не выбрана роль'}
      </h3>
      <p>
        Пустая выдача сама по себе ничего не говорит о рынке. Можно добавить смежную роль, расширить
        регионы или включить удалённый поиск.
      </p>
      {onRetry ? (
        <button type="button" className="btn btn-secondary vacancies-btn" onClick={onRetry}>
          Обновить подбор
        </button>
      ) : null}
    </div>
  );
}

function VacanciesEmptyFilterState({
  totalCount,
  onReset,
}: {
  readonly totalCount: number;
  readonly onReset: () => void;
}) {
  return (
    <div className="state-panel vacancies-filter-empty">
      <span className="state-icon" aria-hidden="true">
        <MagnifyingGlass size={20} />
      </span>
      <h3>По этим фильтрам ничего нет</h3>
      <p>
        В пуле {totalCount} вакансий — под текущие фильтры не подошла ни одна. Ослабьте фильтры или
        сохраните запрос, чтобы получать новые совпадения по расписанию.
      </p>
      <button
        type="button"
        className="btn btn-secondary vacancies-btn vacancies-reset"
        onClick={onReset}
      >
        Сбросить фильтры
      </button>
    </div>
  );
}

interface ListContentProps {
  readonly items: readonly MatchedVacancyItem[];
  readonly total: number;
  readonly now: string;
  readonly selectedId?: string | null;
  readonly onToggleSelect: (id: string) => void;
  readonly applications?: VacanciesScreenProps['applications'];
  readonly archivedApplicationClusterIds?: ReadonlySet<string>;
  readonly onMarkAlreadyApplied?: VacanciesScreenProps['onMarkAlreadyApplied'];
  readonly onScheduleInterview?: VacanciesScreenProps['onScheduleInterview'];
  readonly onOpenNetworking?: (cluster: MatchedVacancyItem['cluster']) => void;
  readonly onOpenResponses?: () => void;
  readonly onOpenArchive?: () => void;
  readonly onAddToProfile?: VacanciesScreenProps['onOpenProfile'];
  readonly onDiscussWithConsultant?: (cluster: MatchedVacancyItem['cluster']) => void;
  readonly countShownAbove: boolean;
}

function VacanciesListHeader({
  totalCount,
  countShownAbove,
}: {
  readonly totalCount: number;
  readonly countShownAbove: boolean;
}) {
  // B338-2: при сводке число уже стоит строкой «Показано N из M» над списком.
  return (
    <div className={`list-head vacancies-list-head${countShownAbove ? ' has-count-above' : ''}`}>
      {countShownAbove ? null : (
        <span className="list-hint vacancies-list-hint">
          {`${pluralRu(totalCount, [
            'вакансия',
            'вакансии',
            'вакансий',
          ])} · показаны совпадающие по роли и уровню`}
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
  const {
    items,
    total,
    now,
    selectedId,
    onToggleSelect,
    applications,
    archivedApplicationClusterIds,
    onMarkAlreadyApplied,
    onScheduleInterview,
    onOpenNetworking,
    onOpenResponses,
    onOpenArchive,
    onAddToProfile,
    onDiscussWithConsultant,
    countShownAbove,
  } = props;

  return (
    <div className="vacancies-list-container">
      <VacanciesListHeader totalCount={total || items.length} countShownAbove={countShownAbove} />

      <ul className="vac-list">
        {items.map((item) => (
          <VacancyRow
            key={item.cluster.id}
            item={item}
            now={now}
            isSelected={selectedId === item.cluster.id}
            onSelect={() => onToggleSelect(item.cluster.id)}
            applications={applications}
            archivedApplicationClusterIds={archivedApplicationClusterIds}
            onMarkAlreadyApplied={onMarkAlreadyApplied}
            onScheduleInterview={onScheduleInterview}
            onOpenNetworking={onOpenNetworking}
            onOpenResponses={onOpenResponses}
            onOpenArchive={onOpenArchive}
            onAddToProfile={onAddToProfile}
            onDiscussWithConsultant={onDiscussWithConsultant}
          />
        ))}
      </ul>
    </div>
  );
}

function SavedSearchesSection({
  open,
  subscriptions,
  onClose,
  onRefresh,
  defaultQuery,
}: {
  readonly defaultQuery?: string;
  readonly open: boolean;
  readonly subscriptions?: readonly VacancySubscription[];
  readonly onClose: () => void;
  readonly onRefresh?: () => Promise<void>;
}) {
  if (!open) return null;
  return (
    <div className="filters-panel is-expanded" aria-label="Сохранённые поиски">
      <div className="filters-panel-head">
        <h3>Сохранённые поиски</h3>
        <button type="button" className="filters-reset" onClick={onClose}>
          Свернуть
        </button>
      </div>
      <SavedSearchesPanel
        subscriptions={subscriptions ?? []}
        defaultQuery={defaultQuery}
        onRefresh={onRefresh ?? (async () => {})}
      />
    </div>
  );
}

function VacanciesMainBody(props: {
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
}) {
  if (props.loading) return <VacanciesSkeletonStack />;
  if (props.failed) {
    return (
      <VacanciesErrorState failureSourceLabel={props.failureSourceLabel} onRetry={props.onRetry} />
    );
  }
  if (props.matchedLength === 0) {
    return <VacanciesEmptyPoolState primaryRole={props.primaryRole} onRetry={props.onRetry} />;
  }
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

function VacanciesFiltersSection({
  board,
  actions,
  candidateLevel,
  subscriptionsCount,
  savedSearchesOpen,
  onToggleSavedSearches,
  onReset,
  facets,
  premises,
  premisesLoading,
  onSavePremises,
  focusRole,
}: {
  readonly facets?: MatchedVacancyFacets;
  readonly board: ReturnType<typeof useVacanciesScreenBoard>;
  readonly actions: ReturnType<typeof useVacancyCampaignActions>;
  readonly candidateLevel?: string | null;
  readonly subscriptionsCount?: number;
  readonly savedSearchesOpen: boolean;
  readonly onToggleSavedSearches: () => void;
  readonly onReset: () => void;
  readonly premises?: RoutePremisesDraft;
  readonly premisesLoading?: boolean;
  readonly onSavePremises?: (draft: RoutePremisesDraft) => Promise<void>;
  readonly focusRole?: boolean;
}) {
  return (
    <VacanciesFilters
      state={board.state}
      facets={facets}
      onChange={board.setState}
      onReset={onReset}
      roleHypotheses={board.roleHypotheses}
      campaignRoles={board.roles}
      regions={board.regions}
      suggestedRegions={board.suggestedRegions}
      candidateLevel={candidateLevel ?? undefined}
      onAddCustomRole={(role) => actions.addCustomRole(role)}
      savedSearchesCount={subscriptionsCount}
      savedSearchesOpen={savedSearchesOpen}
      onToggleSavedSearches={onToggleSavedSearches}
      premises={premises}
      premisesLoading={premisesLoading}
      onSavePremises={onSavePremises}
      focusRole={focusRole}
    />
  );
}

function useVacanciesScreenState(input: VacanciesScreenProps) {
  const { campaign, matched, now: providedNow } = input;
  const now = providedNow ?? new Date().toISOString();
  const [activeCampaign, setActiveCampaign] = useActiveCampaign(campaign);
  const board = useVacanciesScreenBoard(matched, activeCampaign, now, input.onFiltersChange);
  const actions = useVacancyCampaignActions(activeCampaign, {
    onCampaignUpdated: campaignUpdateHandler(setActiveCampaign, board.setState),
    onRetry: input.onRetry,
  });
  const [outreachVacancy, setOutreachVacancy] = useState<MatchedVacancyItem['cluster']>();
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [savedSearchesOpen, setSavedSearchesOpen] = useState(false);

  const resetFilters = () =>
    board.setState({ roles: [], regions: [], levels: [], sources: [], remoteOnly: false });

  return {
    now,
    activeCampaign,
    board,
    actions,
    outreachVacancy,
    setOutreachVacancy,
    viewMode,
    setViewMode,
    savedSearchesOpen,
    setSavedSearchesOpen,
    resetFilters,
  };
}

function buildListProps(
  input: VacanciesScreenProps,
  screenState: ReturnType<typeof useVacanciesScreenState>,
): ListContentProps {
  return {
    items: screenState.board.filtered,
    total: input.total || screenState.board.filtered.length,
    now: screenState.now,
    selectedId: screenState.board.selectedId,
    onToggleSelect: screenState.board.toggleSelect,
    applications: input.applications,
    archivedApplicationClusterIds: input.archivedApplicationClusterIds,
    onMarkAlreadyApplied: input.onMarkAlreadyApplied,
    onScheduleInterview: input.onScheduleInterview,
    onOpenNetworking: input.onOpenNetworking ?? screenState.setOutreachVacancy,
    onOpenResponses: input.onOpenResponses,
    onOpenArchive: input.onOpenArchive,
    onAddToProfile: input.onOpenProfile,
    onDiscussWithConsultant: input.onOpenExpert
      ? (cluster) => input.onOpenExpert?.('vacancies', { kind: 'vacancy', id: cluster.id }, `О вакансии: ${cluster.canonicalTitle}${cluster.canonicalCompany ? ` — ${cluster.canonicalCompany}` : ''}`)
      : undefined,
    countShownAbove: Boolean(input.facets),
  };
}

function ResultCount({
  input,
  shown,
}: {
  readonly input: VacanciesScreenProps;
  readonly shown: number;
}) {
  if (!input.facets) return null;
  const verb = input.poolComplete === false ? 'Загружено' : 'Показано';
  return (
    <p className="list-hint" aria-live="polite">
      {verb} <span className="vacancy-facet-count">{shown}</span> из{' '}
      <span className="vacancy-facet-count">{input.facets.total}</span>
    </p>
  );
}

function mainBodyProps(
  input: VacanciesScreenProps,
  screenState: ReturnType<typeof useVacanciesScreenState>,
) {
  const { board, viewMode, resetFilters } = screenState;
  return {
    loading: Boolean(input.loading),
    failed: Boolean(input.failed),
    failureSourceLabel: input.failureSourceLabel,
    onRetry: input.onRetry,
    matchedLength: input.facets?.total ?? input.matched.length,
    primaryRole: board.primaryRole,
    total: input.total ?? input.matched.length,
    filtered: board.filtered,
    viewMode,
    onResetFilters: resetFilters,
    selectedCity: board.state.selectedCity,
    onSelectCity: (city?: string) =>
      board.setState((prev: VacanciesScreenState) => ({ ...prev, selectedCity: city })),
    listProps: buildListProps(input, screenState),
  };
}

function VacanciesScreenContent({
  input,
  screenState,
}: {
  readonly input: VacanciesScreenProps;
  readonly screenState: ReturnType<typeof useVacanciesScreenState>;
}) {
  const { board, actions, activeCampaign, savedSearchesOpen, setSavedSearchesOpen, resetFilters } =
    screenState;

  return (
    <div className="vacancies-content">
      <VacancyHypothesisSection campaign={activeCampaign} board={board} actions={actions} />
      <VacanciesFiltersSection
        facets={input.facets}
        board={board}
        actions={actions}
        candidateLevel={input.candidateLevel}
        subscriptionsCount={input.subscriptions?.length}
        savedSearchesOpen={savedSearchesOpen}
        onToggleSavedSearches={() => setSavedSearchesOpen((prev) => !prev)}
        onReset={resetFilters}
        premises={input.premises}
        premisesLoading={input.premisesLoading}
        onSavePremises={input.onSavePremises}
        focusRole={input.focusRoleFilter}
      />
      <SavedSearchesSection
        defaultQuery={board.state.roles[0] ?? board.primaryRole}
        open={savedSearchesOpen}
        subscriptions={input.subscriptions}
        onClose={() => setSavedSearchesOpen(false)}
        onRefresh={input.onRefreshSubscriptions}
      />
      <ResultCount
        input={input}
        shown={board.state.selectedCity ? board.filtered.length : input.total}
      />
      <VacanciesMainBody {...mainBodyProps(input, screenState)} />
    </div>
  );
}

export function VacanciesScreen(input: VacanciesScreenProps) {
  const screenState = useVacanciesScreenState(input);
  const { board, viewMode, setViewMode, outreachVacancy, setOutreachVacancy } = screenState;

  return (
    <div className="vacancies-screen">
      <PageHeader
        kicker={board.primaryRole ? `Кампания · ${board.primaryRole}` : 'Кампания'}
        title="Вакансии"
        description="Отклик оформляется здесь, без перехода на площадку."
        right={<ViewSwitch viewMode={viewMode} onChange={setViewMode} />}
        onAskConsultant={input.onOpenExpert ? () => input.onOpenExpert?.('vacancies') : undefined}
      />

      {input.pathIndicator ? (
        <nav className="path-strip" aria-label="Путь кампании">
          <CareerPathIndicator
            steps={input.pathIndicator.steps}
            onNavigate={input.pathIndicator.onNavigate}
          />
        </nav>
      ) : null}

      <VacanciesScreenContent input={input} screenState={screenState} />

      {outreachVacancy ? (
        <DesktopOutreachModal
          isOpen
          onClose={() => setOutreachVacancy(undefined)}
          vacancy={{
            id: outreachVacancy.id,
            title: outreachVacancy.canonicalTitle,
            company: outreachVacancy.canonicalCompany,
            location: outreachVacancy.canonicalLocation,
            isRemote: outreachVacancy.isRemote,
            skills: outreachVacancy.skills,
          }}
        />
      ) : null}
    </div>
  );
}

function campaignUpdateHandler(
  setCampaign: ReturnType<typeof useActiveCampaign>[1],
  setScreenState: ReturnType<typeof useVacanciesScreenBoard>['setState'],
) {
  return (updated: CampaignMetaView, addedRole: string | undefined) =>
    applyCampaignUpdate(updated, addedRole, setCampaign, setScreenState);
}

function useActiveCampaign(campaign?: CampaignMetaView) {
  const [active, setActive] = useState(campaign);
  useEffect(() => {
    if (campaign) setActive(campaign);
  }, [campaign]);
  return [active, setActive] as const;
}

function applyCampaignUpdate(
  campaign: CampaignMetaView,
  addedRole: string | undefined,
  setCampaign: ReturnType<typeof useActiveCampaign>[1],
  setScreenState: ReturnType<typeof useVacanciesScreenBoard>['setState'],
) {
  setCampaign(campaign);
  setScreenState((current: VacanciesScreenState) => ({
    ...current,
    roles: addedRole ? [...current.roles, addedRole] : current.roles,
    regions: current.regions,
    remoteOnly: current.remoteOnly,
  }));
}

function VacancyHypothesisSection({
  campaign,
  board,
  actions,
}: {
  readonly campaign?: CampaignMetaView;
  readonly board: ReturnType<typeof useVacanciesScreenBoard>;
  readonly actions: ReturnType<typeof useVacancyCampaignActions>;
}) {
  const [regionsOpen, setRegionsOpen] = useState(false);
  const hypothesis = campaign?.roleHypotheses?.find(
    (item) => item.role === board.primaryRole && item.isHypothesis,
  );
  if (!hypothesis) return null;

  const adjacentRole = campaign?.autoRoles?.find(
    (role) => role.kind === 'adjacent' && !campaign.roles.value.includes(role.title),
  );
  const availableRegions = CANDIDATE_REGION_CATALOGUE.filter(
    (region) => !board.regions.includes(region.id),
  );

  return (
    <VacancyHypothesisBanner
      role={hypothesis.role}
      vacancyCount={hypothesis.vacancyCount}
      adjacentRole={adjacentRole}
      regionsChosenExplicitly={
        campaign?.regions.origin === 'explicit' && campaign.regions.value.length > 0
      }
      remoteOnly={campaign?.remoteOnly ?? false}
      saving={actions.saving}
      error={actions.error}
      onAddAdjacentRole={(role) => void actions.addAdjacentRole(role)}
      onAddRegion={(region) => {
        void actions.addRegion(region).then((saved) => {
          if (saved) setRegionsOpen(false);
        });
      }}
      onToggleRemote={() => void actions.toggleRemote()}
      regionsOpen={regionsOpen}
      onToggleRegions={() => setRegionsOpen((open) => !open)}
      availableRegions={availableRegions}
    />
  );
}

function filterByScreenState(
  items: readonly MatchedVacancyItem[],
  state: VacanciesScreenState,
  now: string,
): MatchedVacancyItem[] {
  void now;
  return items.filter((item) => {
    const { cluster } = item;
    if (
      state.roles.length > 0 &&
      !state.roles.some((role: string) => titleMatchesRole(cluster.canonicalTitle, role))
    ) {
      return false;
    }
    if (state.remoteOnly && !cluster.isRemote) return false;
    if (state.regions.length > 0 && !state.remoteOnly) {
      const location = cluster.canonicalLocation?.toLocaleLowerCase('ru-RU') ?? '';
      const inRegion = state.regions.some((region: string) =>
        location.includes(region.toLocaleLowerCase('ru-RU')),
      );
      if (!inRegion && !cluster.isRemote) return false;
    }
    if (state.selectedCity && !matchesVacancyCity(item, state.selectedCity, items)) return false;
    return true;
  });
}

/** Единственная точка «есть совпадение» на всех трёх fit-dots (B248/B324). */
export function FitDot({
  isYes,
  title,
  ariaLabel,
  isUnknown = false,
}: {
  readonly isYes: boolean;
  readonly title: string;
  readonly ariaLabel?: string;
  readonly isUnknown?: boolean;
}) {
  return (
    <span
      className={`fit-dot${isUnknown ? ' is-unknown' : isYes ? ' is-yes' : ' is-no'}`}
      title={title}
      aria-label={ariaLabel ?? `${title}: ${isYes ? 'совпадает' : 'не совпадает'}`}
      role="img"
    >
      {isUnknown ? '?' : isYes ? <Check weight="bold" size={11} /> : '—'}
    </span>
  );
}
