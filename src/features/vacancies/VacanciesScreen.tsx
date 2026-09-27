import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { CampaignMetaView } from '../coach/matchedVacancyApi';
import { titleMatchesRole } from '../../../shared/vacancyRoleTitleMatch';
import { vacancyAge } from './vacancyFilters';
import { VacancyDetailPanel } from './VacancyDetailPanel';
import { VacancyHypothesisBanner } from './VacancyHypothesisBanner';
import { useVacancyCampaignActions } from './useVacancyCampaignActions';
import { CareerPathIndicator } from '../shell/CareerPathIndicator';
import { PageHeader } from '../shell/PageHeader';
import type { PathDestination, PathStep } from '../shell/pathIndicator';
import type { VacancyApplications } from './useVacancyApplications';
import { CANDIDATE_REGION_CATALOGUE } from '../workspace/candidateRegions';
import {
  VacanciesFilters,
  VacanciesList,
  type VacanciesScreenState,
} from './VacanciesScreenFilters';

const EMPTY_STATE: VacanciesScreenState = { roles: [], regions: [], remoteOnly: false };

/**
 * «Вакансии» (B248/B250) — верх экрана и список пула.
 *
 * Роль кампании и её гипотезы, уровень кандидата и счётчик по каждой роли уже
 * едут с первой страницей пула (B247, срез 2); экран их только показывает и
 * фильтрует список тем же признаком `titleMatchesRole`, что и сервер, чтобы
 * баннер и список не расходились в счёте.
 */
export interface VacanciesPathIndicator {
  readonly steps: readonly PathStep[];
  readonly onNavigate: (destination: PathDestination) => void;
}

interface VacanciesScreenProps {
  readonly matched: readonly MatchedVacancyItem[];
  readonly total: number;
  readonly campaign?: CampaignMetaView;
  readonly candidateLevel?: string | null;
  readonly loading?: boolean;
  readonly failed?: boolean;
  readonly failureSourceLabel?: string;
  readonly onRetry?: () => void;
  readonly now?: string;
  /** B248 §2 — тот же индикатор пути, что и на остальных экранах кампании. */
  readonly pathIndicator?: VacanciesPathIndicator;
  readonly applications?: VacancyApplications;
  readonly onOpenResponses?: () => void;
  readonly onOpenProfile?: () => void;
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

function useVacanciesScreenBoard(
  matched: readonly MatchedVacancyItem[],
  campaign: CampaignMetaView | undefined,
  now: string,
) {
  const { roles, regions, suggestedRegions } = extractBoardRegions(campaign);
  const [state, setState] = useState<VacanciesScreenState>({
    ...EMPTY_STATE,
    regions,
    remoteOnly: campaign?.remoteOnly ?? false,
  });
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  useEffect(() => {
    if (!campaign) return;
    const effectiveRegions = extractBoardRegions(campaign).regions;
    setState((current) => ({
      ...current,
      roles: current.roles.filter((role) => campaign.roles.value.includes(role)),
      regions: current.regions.length > 0 ? current.regions : effectiveRegions,
      remoteOnly: campaign?.remoteOnly ?? false,
    }));
  }, [campaign]);

  const filtered = useMemo(() => filterByScreenState(matched, state, now), [matched, state, now]);
  const effectiveId = selectedId ?? filtered[0]?.cluster.id;

  return {
    roles,
    regions,
    suggestedRegions,
    state,
    setState,
    filtered,
    effectiveId,
    selectedItem: filtered.find((item) => item.cluster.id === effectiveId),
    roleHypotheses: campaign?.roleHypotheses ?? [],
    primaryRole: state.roles[0] ?? roles[0],
    mobileDetailOpen,
    onSelect: (id: string) => {
      setSelectedId(id);
      setMobileDetailOpen(true);
    },
    onBack: () => setMobileDetailOpen(false),
  };
}

export function VacanciesScreen({
  matched,
  total,
  campaign,
  candidateLevel,
  loading = false,
  failed = false,
  failureSourceLabel,
  onRetry,
  now = new Date().toISOString(),
  pathIndicator,
  applications,
  onOpenResponses,
  onOpenProfile,
}: VacanciesScreenProps) {
  const [activeCampaign, setActiveCampaign] = useActiveCampaign(campaign);
  const board = useVacanciesScreenBoard(matched, activeCampaign, now);
  const actions = useVacancyCampaignActions(activeCampaign, {
    onCampaignUpdated: campaignUpdateHandler(setActiveCampaign, board.setState),
    onRetry,
  });

  return (
    <div className="vacancies-screen">
      <VacanciesScreenHeader primaryRole={board.primaryRole} pathIndicator={pathIndicator} />
      <VacanciesScreenBody
        loading={loading}
        failed={failed}
        failureSourceLabel={failureSourceLabel}
        onRetry={onRetry}
      >
        <VacanciesResults
          matched={matched}
          total={total}
          campaign={activeCampaign}
          candidateLevel={candidateLevel}
          now={now}
          applications={applications}
          board={board}
          actions={actions}
          onRetry={onRetry}
          onOpenResponses={onOpenResponses}
          onOpenProfile={onOpenProfile}
        />
      </VacanciesScreenBody>
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

function VacanciesScreenHeader({
  primaryRole,
  pathIndicator,
}: {
  readonly primaryRole?: string;
  readonly pathIndicator?: VacanciesPathIndicator;
}) {
  return (
    <>
      <VacanciesHeader primaryRole={primaryRole} />
      {pathIndicator ? (
        <CareerPathIndicator steps={pathIndicator.steps} onNavigate={pathIndicator.onNavigate} />
      ) : null}
    </>
  );
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
  setScreenState((current) => ({
    ...current,
    roles: addedRole ? [...current.roles, addedRole] : current.roles,
    regions: campaign.regions.value,
    remoteOnly: campaign.remoteOnly ?? false,
  }));
}

function VacanciesScreenBody({
  loading,
  failed,
  failureSourceLabel,
  onRetry,
  children,
}: {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly failureSourceLabel?: string;
  readonly onRetry?: () => void;
  readonly children: ReactNode;
}) {
  if (loading) {
    return (
      <div className="vacancies-content">
        <VacanciesLoadingState />
      </div>
    );
  }
  if (failed) {
    return (
      <div className="vacancies-content">
        <VacanciesErrorState sourceLabel={failureSourceLabel} onRetry={onRetry} />
      </div>
    );
  }
  return children;
}

interface VacanciesResultsProps {
  readonly matched: readonly MatchedVacancyItem[];
  readonly total: number;
  readonly campaign?: CampaignMetaView;
  readonly candidateLevel?: string | null;
  readonly now: string;
  readonly applications?: VacancyApplications;
  readonly board: ReturnType<typeof useVacanciesScreenBoard>;
  readonly actions: ReturnType<typeof useVacancyCampaignActions>;
  readonly onRetry?: () => void;
  readonly onOpenResponses?: () => void;
  readonly onOpenProfile?: () => void;
}

function VacanciesResults(props: VacanciesResultsProps) {
  return (
    <div className="vacancies-content">
      <VacancyHypothesisSection
        campaign={props.campaign}
        board={props.board}
        actions={props.actions}
      />
      {props.matched.length === 0 ? (
        <VacanciesEmptyState role={props.board.primaryRole} onRetry={props.onRetry} />
      ) : (
        <VacanciesLayout
          roleHypotheses={props.board.roleHypotheses}
          regions={props.board.regions}
          suggestedRegions={props.board.suggestedRegions}
          remoteOnly={props.campaign?.remoteOnly ?? false}
          candidateLevel={props.candidateLevel}
          state={props.board.state}
          onChange={props.board.setState}
          onReset={() =>
            props.board.setState({
              ...EMPTY_STATE,
              regions: props.board.regions,
              remoteOnly: props.campaign?.remoteOnly ?? false,
            })
          }
          total={props.total}
          filtered={props.board.filtered}
          now={props.now}
          effectiveId={props.board.effectiveId}
          selectedItem={props.board.selectedItem}
          applications={props.applications}
          mobileDetailOpen={props.board.mobileDetailOpen}
          onSelect={props.board.onSelect}
          onBack={props.board.onBack}
          onOpenResponses={props.onOpenResponses}
          onOpenProfile={props.onOpenProfile}
        />
      )}
    </div>
  );
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

function VacanciesLoadingState() {
  return (
    <p className="vacancies-state" aria-busy="true">
      Загружаем подборку по кампании…
    </p>
  );
}

function VacanciesErrorState({
  sourceLabel,
  onRetry,
}: {
  readonly sourceLabel?: string;
  readonly onRetry?: () => void;
}) {
  return (
    <section className="vacancies-state is-error" role="alert">
      <h2>Не удалось загрузить подборку</h2>
      <p>
        Не удалось загрузить общий пул вакансий.{' '}
        {sourceLabel ? `Проблемные источники: ${sourceLabel}.` : 'Источник сбоя не определён.'}{' '}
        Сохранённые запросы показываются отдельно; роль и география сохранены.
      </p>
      {onRetry ? (
        <button type="button" className="vacancies-btn vacancies-btn-primary" onClick={onRetry}>
          Повторить
        </button>
      ) : null}
    </section>
  );
}

function VacanciesEmptyState({
  role,
  onRetry,
}: {
  readonly role?: string;
  readonly onRetry?: () => void;
}) {
  return (
    <section className="vacancies-state">
      <h2>{role ? `По роли ${role} пока нет вакансий` : 'Для подбора не выбрана роль'}</h2>
      <p>
        Пустая выдача сама по себе ничего не говорит о рынке. Можно добавить смежную роль, расширить
        регионы или включить удалённый поиск.
      </p>
      {onRetry ? (
        <button type="button" className="vacancies-btn vacancies-btn-secondary" onClick={onRetry}>
          Обновить подбор
        </button>
      ) : null}
    </section>
  );
}

interface VacanciesLayoutProps {
  readonly roleHypotheses: NonNullable<CampaignMetaView['roleHypotheses']>;
  readonly regions: readonly string[];
  readonly suggestedRegions?: readonly string[];
  readonly remoteOnly: boolean;
  readonly candidateLevel?: string | null;
  readonly state: VacanciesScreenState;
  readonly onChange: (updater: (prev: VacanciesScreenState) => VacanciesScreenState) => void;
  readonly onReset: () => void;
  readonly total: number;
  readonly filtered: readonly MatchedVacancyItem[];
  readonly now: string;
  readonly effectiveId?: string;
  readonly selectedItem?: MatchedVacancyItem;
  readonly applications?: VacancyApplications;
  readonly mobileDetailOpen: boolean;
  readonly onSelect: (id: string) => void;
  readonly onBack: () => void;
  readonly onOpenResponses?: () => void;
  readonly onOpenProfile?: () => void;
}

function VacanciesLayout(props: VacanciesLayoutProps) {
  return (
    <div className="vacancies-layout">
      <VacanciesFilters {...props} />
      <VacanciesList
        total={props.total}
        items={props.filtered}
        now={props.now}
        selectedId={props.effectiveId}
        onSelect={props.onSelect}
        onReset={props.onReset}
      />
      <aside
        className={`vacancies-detail-col${props.mobileDetailOpen ? ' is-open' : ''}`}
        aria-label="Карточка вакансии"
      >
        {props.selectedItem ? (
          <VacancyDetailPanel
            item={props.selectedItem}
            now={props.now}
            applications={props.applications}
            onBack={props.onBack}
            onOpenResponses={props.onOpenResponses}
            onAddToProfile={props.onOpenProfile}
          />
        ) : null}
      </aside>
    </div>
  );
}

function VacanciesHeader({ primaryRole }: { readonly primaryRole?: string }) {
  return (
    <PageHeader
      kicker={primaryRole ? `Кампания · ${primaryRole}` : 'Кампания'}
      title="Вакансии"
      description="Отклик оформляется здесь, без перехода на площадку."
    />
  );
}

function filterByScreenState(
  items: readonly MatchedVacancyItem[],
  state: VacanciesScreenState,
  now: string,
): MatchedVacancyItem[] {
  return items.filter(({ cluster }) => {
    if (
      state.roles.length > 0 &&
      !state.roles.some((role) => titleMatchesRole(cluster.canonicalTitle, role))
    ) {
      return false;
    }
    if (state.remoteOnly && !cluster.isRemote) return false;
    if (state.regions.length > 0 && !state.remoteOnly) {
      const location = cluster.canonicalLocation?.toLocaleLowerCase('ru-RU') ?? '';
      const inRegion = state.regions.some((region) =>
        location.includes(region.toLocaleLowerCase('ru-RU')),
      );
      if (!inRegion && !cluster.isRemote) return false;
    }
    if (state.freshnessDays !== undefined) {
      const { days } = vacancyAge(cluster, now);
      if (days === null || days > state.freshnessDays) return false;
    }
    return true;
  });
}

/** Единственная точка «есть совпадение» на всех трёх fit-dots (B248). */
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
    >
      {isUnknown ? '?' : isYes ? <Check weight="bold" size={11} /> : '—'}
    </span>
  );
}
