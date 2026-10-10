import type { MatchedVacancyFacets } from '../../../shared/matchedVacancyFacets';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Check, List, MapTrifold, Sparkle } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { CampaignMetaView } from '../coach/matchedVacancyApi';
import type { ApplicationView } from '../applications/applicationsApi';
import type { VacancyApplicationSnapshot } from '../../../shared/vacancyApplication';
import type { VacancySubscription, CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { DesktopOutreachModal } from '../outreach/DesktopOutreachModal';
import type { VacancyProfileRequirement } from './vacancyProfileRequirement';
import { VacancyHypothesisBanner } from './VacancyHypothesisBanner';
import { useVacancyCampaignActions } from './useVacancyCampaignActions';
import { PageHeader } from '../shell/PageHeader';
import type { NavigationOptions, PathDestination, PathStep } from '../shell/pathIndicator';
import type { VacancyApplications } from './useVacancyApplications';
import {
  countActiveFilters,
  VacanciesFilters,
  type VacanciesScreenState,
} from './VacanciesScreenFilters';
import { VacanciesMainBody } from './VacanciesScreenResults';
import { CompaniesAndPeopleScreen } from './CompaniesAndPeopleScreen';
import { OpportunityTabs, type OpportunityTab } from './VacanciesScreenSections';
import { VacanciesScreenSummary } from './VacanciesScreenSummary';

import type { RoutePremisesDraft } from '../cabinet/routePremises';

import { buildVacancyFilterOptions, filterByScreenState } from './vacancyScreenCriteria';
export { filterByScreenState } from './vacancyScreenCriteria';
import {
  SavedVacanciesPanel,
  companyLookupKey,
  useVacancyCollections,
} from './vacancyScreenCollections';

import { CANDIDATE_REGION_CATALOGUE } from '../workspace/candidateRegions';

import './vacancies-screen.css';

export interface VacanciesPathIndicator {
  readonly steps: readonly PathStep[];
  readonly onNavigate: (destination: PathDestination, options?: NavigationOptions) => void;
}

export interface VacanciesScreenProps {
  readonly facets?: MatchedVacancyFacets;
  readonly initialFilters?: VacanciesScreenState;
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
  readonly savedVacancies?: readonly ApplicationView[];
  readonly companiesCount?: number;
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
  readonly onOpenConnections?: () => void;
  readonly onOpenNotifications?: () => void;
  readonly onOpenProfile?: (context: VacancyProfileRequirement) => void;
  readonly onOpenNetworking?: (vacancy: MatchedVacancyItem['cluster']) => void;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
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

function filterBoardVacancies(
  matched: readonly MatchedVacancyItem[],
  state: VacanciesScreenState,
  now: string,
  onFiltersChange?: VacanciesScreenProps['onFiltersChange'],
) {
  const filters = onFiltersChange ? { ...state, roles: [], regions: [], remoteOnly: false } : state;
  return filterByScreenState(matched, filters, now);
}

function useVacanciesScreenBoard(
  matched: readonly MatchedVacancyItem[],
  campaign: CampaignMetaView | undefined,
  now: string,
  onFiltersChange?: VacanciesScreenProps['onFiltersChange'],
  initialFilters?: VacanciesScreenState,
) {
  const { roles, regions, suggestedRegions } = extractBoardRegions(campaign);
  const [state, setState] = useState<VacanciesScreenState>(
    initialFilters ?? {
      roles: [],
      regions: [],
      levels: [],
      sources: [],
      remoteOnly: false,
    },
  );
  useInitialVacancyFilters(initialFilters, setState);
  const [visibleCount, setVisibleCount] = useState(20);
  const [selectedId, setSelectedId] = useState<string | null | undefined>(() =>
    initialSelectedId(matched),
  );

  useEffect(() => {
    if (selectedId === undefined && matched.length > 0) setSelectedId(initialSelectedId(matched));
  }, [matched, selectedId]);
  useEffect(() => {
    onFiltersChange?.(state);
  }, [state, onFiltersChange]);
  useEffect(() => setVisibleCount(20), [state]);

  const filtered = useMemo(
    () => filterBoardVacancies(matched, state, now, onFiltersChange),
    [matched, state, now, onFiltersChange],
  );
  return {
    roles,
    regions,
    suggestedRegions,
    state,
    setState,
    filtered,
    visibleItems: filtered.slice(0, visibleCount),
    hasMore: visibleCount < filtered.length,
    loadMore: () => setVisibleCount((count) => count + 20),
    selectedId,
    setSelectedId,
    toggleSelect: (id: string) => setSelectedId((prev) => (prev === id ? null : id)),
    roleHypotheses: campaign?.roleHypotheses ?? [],
    primaryRole: state.roles[0] ?? roles[0],
  };
}


function useInitialVacancyFilters(
  initialFilters: VacanciesScreenState | undefined,
  setState: (state: VacanciesScreenState) => void,
) {
  const applied = useRef(Boolean(initialFilters));
  useEffect(() => {
    if (!initialFilters || applied.current) return;
    setState(initialFilters);
    applied.current = true;
  }, [initialFilters, setState]);
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

export interface ListContentProps {
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
  readonly savedClusterIds?: ReadonlySet<string>;
  readonly savedBusyIds?: ReadonlySet<string>;
  readonly companyWantByClusterId?: ReadonlyMap<string, boolean>;
  readonly companyWantKnownClusterIds?: ReadonlySet<string>;
  readonly companyBusyClusterIds?: ReadonlySet<string>;
  readonly companyContactsCountByClusterId?: ReadonlyMap<string, number | null>;
  readonly onOpenCompanyPath?: (companyName?: string) => void;
  readonly onToggleSaved?: (cluster: MatchedVacancyItem['cluster']) => Promise<void>;
  readonly onToggleCompanyWant?: (companyName?: string) => Promise<void>;
  readonly collectionActionError?: string;
  readonly hasMore?: boolean;
  readonly onLoadMore?: () => void;
  readonly countShownAbove: boolean;
  readonly poolComplete?: boolean;
}

interface VacanciesFiltersSectionProps {
  readonly facets?: MatchedVacancyFacets;
  readonly board: ReturnType<typeof useVacanciesScreenBoard>;
  readonly actions: ReturnType<typeof useVacancyCampaignActions>;
  readonly candidateLevel?: string | null;
  readonly onReset: () => void;
  readonly premises?: RoutePremisesDraft;
  readonly premisesLoading?: boolean;
  readonly onSavePremises?: (draft: RoutePremisesDraft) => Promise<void>;
  readonly focusRole?: boolean;
  readonly filterOptions: ReturnType<typeof buildVacancyFilterOptions>;
}

function buildVacanciesFilterProps({
  facets,
  board,
  actions,
  candidateLevel,
  onReset,
  premises,
  premisesLoading,
  onSavePremises,
  focusRole,
  filterOptions,
}: VacanciesFiltersSectionProps) {
  return {
    state: board.state,
    facets,
    onChange: board.setState,
    onReset,
    roleHypotheses: board.roleHypotheses,
    campaignRoles: board.roles,
    regions: board.regions,
    suggestedRegions: board.suggestedRegions,
    candidateLevel: candidateLevel ?? undefined,
    onAddCustomRole: (role: string) => actions.addCustomRole(role),
    premises,
    premisesLoading,
    onSavePremises,
    focusRole,
    ...filterOptions,
  };
}

function VacanciesFiltersSection(props: VacanciesFiltersSectionProps) {
  return <VacanciesFilters {...buildVacanciesFilterProps(props)} />;
}

function useVacanciesScreenState(input: VacanciesScreenProps) {
  const { campaign, matched, now: providedNow } = input;
  const now = providedNow ?? new Date().toISOString();
  const [activeCampaign, setActiveCampaign] = useActiveCampaign(campaign);
  const board = useVacanciesScreenBoard(matched, activeCampaign, now, input.onFiltersChange, input.initialFilters);
  const collections = useVacancyCollections(input);
  const actions = useVacancyCampaignActions(activeCampaign, {
    onCampaignUpdated: campaignUpdateHandler(setActiveCampaign, board.setState),
    onRetry: input.onRetry,
  });
  const [outreachVacancy, setOutreachVacancy] = useState<MatchedVacancyItem['cluster']>();
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [activeTab, setActiveTab] = useState<OpportunityTab>('selection');
  const [companyPathSearch, setCompanyPathSearch] = useState<string>();

  const chooseTab = (tab: OpportunityTab) => {
    setActiveTab(tab);
  };
  const openCompanyPath = (companyName?: string) => {
    if (!companyName?.trim()) return;
    setCompanyPathSearch(companyName);
    chooseTab('companies');
  };
  const resetFilters = () => resetVacancyFilters(board);

  return {
    now,
    activeCampaign,
    board,
    collections,
    actions,
    outreachVacancy,
    setOutreachVacancy,
    viewMode,
    setViewMode,
    activeTab,
    chooseTab,
    companyPathSearch,
    openCompanyPath,
    resetFilters,
  };
}


function resetVacancyFilters(board: ReturnType<typeof useVacanciesScreenBoard>) {
  board.setState({
    roles: [],
    regions: [],
    levels: [],
    sources: [],
    remoteOnly: false,
    selectedCity: undefined,
    selectedLocations: [],
    locationSearch: '',
    salaryMinimum: undefined,
    salaryMaximum: undefined,
    salaryCurrency: undefined,
    includeMissingSalary: false,
    formats: [],
    freshnessDays: undefined,
  });
}

function companyRowStates(
  items: readonly MatchedVacancyItem[],
  collections: ReturnType<typeof useVacancyCollections>,
) {
  const companyWantByClusterId = new Map<string, boolean>();
  const companyWantKnownClusterIds = new Set<string>();
  const companyBusyClusterIds = new Set<string>();
  const companyContactsCountByClusterId = new Map<string, number | null>();
  for (const item of items) {
    const name = item.cluster.canonicalCompany;
    if (!name) continue;
    const key = companyLookupKey(name);
    const company = collections.companyByName.get(key);
    if (company) {
      companyWantByClusterId.set(item.cluster.id, company.want);
      companyWantKnownClusterIds.add(item.cluster.id);
      companyContactsCountByClusterId.set(item.cluster.id, company.contactsCount);
    }
    if (collections.companyBusyNames.has(key)) companyBusyClusterIds.add(item.cluster.id);
  }
  return {
    companyWantByClusterId,
    companyWantKnownClusterIds,
    companyBusyClusterIds,
    companyContactsCountByClusterId,
  };
}

function buildListProps(
  input: VacanciesScreenProps,
  screenState: ReturnType<typeof useVacanciesScreenState>,
): ListContentProps {
  const { board, collections } = screenState;
  const savedClusterIds = new Set(
    collections.savedApplications
      .map((application) => application.clusterId)
      .filter((id): id is string => Boolean(id)),
  );
  const companyStates = companyRowStates(board.filtered, collections);
  return {
    items: board.visibleItems,
    total: board.filtered.length,
    now: screenState.now,
    selectedId: board.selectedId,
    onToggleSelect: board.toggleSelect,
    applications: input.applications,
    archivedApplicationClusterIds: input.archivedApplicationClusterIds,
    onMarkAlreadyApplied: input.onMarkAlreadyApplied,
    onScheduleInterview: input.onScheduleInterview,
    onOpenNetworking: input.onOpenNetworking ?? screenState.setOutreachVacancy,
    onOpenResponses: input.onOpenResponses,
    onOpenArchive: input.onOpenArchive,
    onAddToProfile: input.onOpenProfile,
    onDiscussWithConsultant: input.onOpenExpert
      ? (cluster) =>
          input.onOpenExpert?.(
            'vacancies',
            { kind: 'vacancy', id: cluster.id },
            `О вакансии: ${cluster.canonicalTitle}${cluster.canonicalCompany ? ` — ${cluster.canonicalCompany}` : ''}`,
          )
      : undefined,
    savedClusterIds,
    savedBusyIds: collections.savedBusyIds,
    ...companyStates,
    onToggleSaved: collections.toggleSaved,
    onToggleCompanyWant: collections.toggleCompanyWant,
    onOpenCompanyPath: screenState.openCompanyPath,
    collectionActionError: collections.actionError,
    hasMore: board.hasMore,
    onLoadMore: board.loadMore,
    countShownAbove: Boolean(input.facets),
    poolComplete: input.poolComplete,
  };
}

function screenFilteredCount(
  input: VacanciesScreenProps,
  localCount: number,
  state: Parameters<typeof countActiveFilters>[0],
) {
  const hasClientFilters =
    state.selectedCity !== undefined || (!input.onFiltersChange && countActiveFilters(state) > 0);
  if (hasClientFilters && input.poolComplete !== false) return localCount;
  return input.total ?? localCount;
}

function ResultCount({
  input,
  shown,
  onToggleView,
  viewMode,
}: {
  readonly input: VacanciesScreenProps;
  readonly shown: number;
  readonly onToggleView: () => void;
  readonly viewMode: 'list' | 'map';
}) {
  const label = input.poolComplete === false ? 'Загружено' : 'Показано';
  const poolTotal = input.facets?.total;
  const ariaCount = poolTotal === undefined ? `${label} ${shown}` : `${label} ${shown} из ${poolTotal}`;
  return (
    <div className="vacancies-mobile-results-summary">
      <p className="list-hint" aria-live="polite" aria-label={ariaCount}>
        <span className="vacancy-facet-count">{shown}</span> вакансий по вашим условиям
      </p>
      <button type="button" className="vacancies-mobile-map-action" onClick={onToggleView}>
        {viewMode === 'list' ? <MapTrifold aria-hidden="true" /> : <List aria-hidden="true" />}
        <span>{viewMode === 'list' ? 'Карта' : 'Список'}</span>
      </button>
    </div>
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

function VacanciesFilterContent({
  input,
  screenState,
}: {
  readonly input: VacanciesScreenProps;
  readonly screenState: ReturnType<typeof useVacanciesScreenState>;
}) {
  const { board, actions, resetFilters } = screenState;
  const filterOptions = useMemo(() => buildVacancyFilterOptions(input.matched), [input.matched]);
  return (
    <div className="vacancies-filter-section">
      <VacanciesScreenSummary
        poolTotal={input.facets?.total ?? input.matched.length}
        filteredTotal={screenFilteredCount(input, board.filtered.length, board.state)}
        shownCount={board.visibleItems.length}
        poolComplete={input.poolComplete !== false}
        activeFilters={countActiveFilters(board.state)}
        catalogSummary={input.facets?.catalogSummary}
        onReset={resetFilters}
      />
      <VacanciesFiltersSection
        facets={input.facets}
        board={board}
        actions={actions}
        candidateLevel={input.candidateLevel}
        onReset={resetFilters}
        premises={input.premises}
        premisesLoading={input.premisesLoading}
        onSavePremises={input.onSavePremises}
        focusRole={input.focusRoleFilter}
        filterOptions={filterOptions}
      />
    </div>
  );
}

function VacanciesScreenContent({
  input,
  screenState,
}: {
  readonly input: VacanciesScreenProps;
  readonly screenState: ReturnType<typeof useVacanciesScreenState>;
}) {
  const { board, activeCampaign } = screenState;
  const filteredTotal = screenFilteredCount(input, board.filtered.length, board.state);
  const shown = input.poolComplete === false ? board.visibleItems.length : filteredTotal;
  return (
    <div className="vacancies-content">
      <VacancyHypothesisSection
        campaign={activeCampaign}
        board={board}
        actions={screenState.actions}
      />
      <ResultCount
        input={input}
        shown={shown}
        onToggleView={() =>
          screenState.setViewMode((current) => (current === 'list' ? 'map' : 'list'))
        }
        viewMode={screenState.viewMode}
      />
      <VacanciesMainBody {...mainBodyProps(input, screenState)} />
    </div>
  );
}

function VacanciesScreenHeader({ input }: { readonly input: VacanciesScreenProps }) {
  return (
    <>
      <header className="vacancies-mobile-topbar" aria-label="Навигация по вакансиям">
        {input.onOpenNotifications ? (
          <button type="button" aria-label="Уведомления" onClick={input.onOpenNotifications}>
            <Bell size={20} aria-hidden="true" />
          </button>
        ) : null}
        <h1>Вакансии</h1>
        {input.onOpenExpert ? (
          <button
            type="button"
            aria-label="Спросить консультанта"
            onClick={() => input.onOpenExpert?.('vacancies')}
          >
            <Sparkle size={20} aria-hidden="true" />
          </button>
        ) : null}
      </header>
      <PageHeader kicker="" title="Вакансии" description="" />
    </>
  );
}

function OpportunityContent({
  input,
  screenState,
  activeTab,
}: {
  readonly input: VacanciesScreenProps;
  readonly screenState: ReturnType<typeof useVacanciesScreenState>;
  readonly activeTab: OpportunityTab;
}) {
  if (activeTab === 'selection')
    return <VacanciesScreenContent input={input} screenState={screenState} />;
  if (activeTab === 'saved') {
    return <SavedVacanciesPanel collections={screenState.collections} />;
  }
  return (
    <CompaniesAndPeopleScreen
      onOpenConnections={input.onOpenConnections}
      initialSearch={screenState.companyPathSearch}
    />
  );
}

function VacancyOutreachDialog({
  screenState,
}: {
  readonly screenState: ReturnType<typeof useVacanciesScreenState>;
}) {
  const { outreachVacancy, setOutreachVacancy } = screenState;
  if (!outreachVacancy) return null;
  return (
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
  );
}

function VacanciesScreenFrame({
  input,
  screenState,
  activeTab,
  onSelectTab,
}: {
  readonly input: VacanciesScreenProps;
  readonly screenState: ReturnType<typeof useVacanciesScreenState>;
  readonly activeTab: OpportunityTab;
  readonly onSelectTab: (tab: OpportunityTab) => void;
}) {
  return (
    <div className="vacancies-screen">
      <VacanciesScreenHeader input={input} />
      {activeTab === 'selection' ? (
        <VacanciesFilterContent input={input} screenState={screenState} />
      ) : null}
      <div className="vacancies-tabs-row">
        <OpportunityTabs
          active={activeTab}
          totalVacancies={input.total}
          savedCount={screenState.collections.savedApplications.length}
          companiesCount={screenState.collections.companiesCount}
          onSelect={onSelectTab}
        />
        {activeTab === 'selection' ? (
          <ViewSwitch viewMode={screenState.viewMode} onChange={screenState.setViewMode} />
        ) : null}
      </div>
      {screenState.collections.actionError ? (
        <p className="career-inline-error" role="alert">
          {screenState.collections.actionError}
        </p>
      ) : null}
      <OpportunityContent input={input} screenState={screenState} activeTab={activeTab} />
      <VacancyOutreachDialog screenState={screenState} />
    </div>
  );
}

export function VacanciesScreen(input: VacanciesScreenProps) {
  const screenState = useVacanciesScreenState(input);
  return (
    <VacanciesScreenFrame
      input={input}
      screenState={screenState}
      activeTab={screenState.activeTab}
      onSelectTab={screenState.chooseTab}
    />
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
