import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { CampaignMetaView } from '../coach/matchedVacancyApi';
import { titleMatchesRole } from '../../../shared/vacancyRoleTitleMatch';
import { pluralRu } from '../../../shared/pluralRu';
import { vacancyAge } from './vacancyFilters';
import { VacancyRow } from './VacancyRow';
import { VacancyDetailPanel } from './VacancyDetailPanel';
import { VacancyHypothesisBanner } from './VacancyHypothesisBanner';
import { useVacancyCampaignActions } from './useVacancyCampaignActions';
import { CareerPathIndicator } from '../shell/CareerPathIndicator';
import type { PathDestination, PathStep } from '../shell/pathIndicator';
import type { VacancyApplications } from './useVacancyApplications';
import { CANDIDATE_REGION_CATALOGUE } from '../workspace/candidateRegions';

const FRESHNESS_OPTIONS = [
  { days: 0, label: 'Сегодня' },
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
] as const;

export interface VacanciesScreenState {
  readonly role?: string;
  readonly regions: readonly string[];
  readonly remoteOnly: boolean;
  readonly freshnessDays?: number;
}

const EMPTY_STATE: VacanciesScreenState = { regions: [], remoteOnly: false };

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
}

function useVacanciesScreenBoard(
  matched: readonly MatchedVacancyItem[],
  campaign: CampaignMetaView | undefined,
  now: string,
) {
  const roles = campaign?.roles.value ?? [];
  const regions = campaign?.regions.value ?? [];
  const [state, setState] = useState<VacanciesScreenState>({
    ...EMPTY_STATE,
    role: roles[0],
    regions,
    remoteOnly: campaign?.remoteOnly ?? false,
  });
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  useEffect(() => {
    if (!campaign) return;
    setState((current) => ({
      ...current,
      role: current.role && campaign.roles.value.includes(current.role)
        ? current.role
        : campaign.roles.value[0],
      regions: current.regions.length > 0 ? current.regions : campaign.regions.value,
      remoteOnly: campaign?.remoteOnly ?? false,
    }));
  }, [campaign]);

  const filtered = useMemo(() => filterByScreenState(matched, state, now), [matched, state, now]);
  const effectiveId = selectedId ?? filtered[0]?.cluster.id;

  return {
    roles,
    regions,
    state,
    setState,
    filtered,
    effectiveId,
    selectedItem: filtered.find((item) => item.cluster.id === effectiveId),
    roleHypotheses: campaign?.roleHypotheses ?? [],
    primaryRole: state.role ?? roles[0],
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
}: VacanciesScreenProps) {
  const [activeCampaign, setActiveCampaign] = useActiveCampaign(campaign);
  const board = useVacanciesScreenBoard(matched, activeCampaign, now);
  const actions = useVacancyCampaignActions(activeCampaign, {
    onCampaignUpdated: (updated, selectedRole) =>
      applyCampaignUpdate(updated, selectedRole, setActiveCampaign, board.setState),
    onRetry,
  });

  return (
    <div className="vacancies-screen">
      <VacanciesHeader primaryRole={board.primaryRole} />
      {pathIndicator ? (
        <CareerPathIndicator steps={pathIndicator.steps} onNavigate={pathIndicator.onNavigate} />
      ) : null}
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
          onToggleRemote={() => void actions.toggleRemote()}
        />
      </VacanciesScreenBody>
    </div>
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
  selectedRole: string | undefined,
  setCampaign: ReturnType<typeof useActiveCampaign>[1],
  setScreenState: ReturnType<typeof useVacanciesScreenBoard>['setState'],
) {
  setCampaign(campaign);
  setScreenState((current) => ({
    ...current,
    role: selectedRole ?? current.role,
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
  if (loading) return <VacanciesLoadingState />;
  if (failed) return <VacanciesErrorState sourceLabel={failureSourceLabel} onRetry={onRetry} />;
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
  readonly onToggleRemote: () => void;
}

function VacanciesResults(props: VacanciesResultsProps) {
  return (
    <div className="vacancies-content">
      <VacancyHypothesisSection campaign={props.campaign} board={props.board} actions={props.actions} />
      {props.matched.length === 0 ? (
        <VacanciesEmptyState role={props.board.primaryRole} onRetry={props.onRetry} />
      ) : (
        <VacanciesLayout
          roleHypotheses={props.board.roleHypotheses}
          regions={props.board.regions}
          remoteOnly={props.campaign?.remoteOnly ?? false}
          candidateLevel={props.candidateLevel}
          state={props.board.state}
          onChange={props.board.setState}
          onReset={() =>
            props.board.setState({
              ...EMPTY_STATE,
              role: props.board.roles[0],
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
          onToggleRemote={props.onToggleRemote}
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
        Площадки с проблемным статусом: {sourceLabel ?? 'источник не определён'}. Роль и география
        сохранены.
      </p>
      {onRetry ? (
        <button type="button" className="vacancies-btn vacancies-btn-primary" onClick={onRetry}>
          Повторить
        </button>
      ) : null}
    </section>
  );
}

function VacanciesEmptyState({ role, onRetry }: { readonly role?: string; readonly onRetry?: () => void }) {
  return (
    <section className="vacancies-state">
      <h2>{role ? `По роли ${role} пока нет вакансий` : 'Для подбора не выбрана роль'}</h2>
      <p>
        Пустая выдача сама по себе ничего не говорит о рынке. Можно добавить смежную роль,
        расширить регионы или включить удалённый поиск.
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
  readonly onToggleRemote: () => void;
}

function VacanciesLayout({
  roleHypotheses,
  regions,
  remoteOnly,
  candidateLevel,
  state,
  onChange,
  onReset,
  total,
  filtered,
  now,
  effectiveId,
  selectedItem,
  applications,
  mobileDetailOpen,
  onSelect,
  onBack,
  onToggleRemote,
}: VacanciesLayoutProps) {
  return (
    <div className="vacancies-layout">
      <VacanciesFilters
        roleHypotheses={roleHypotheses}
        regions={regions}
        remoteOnly={remoteOnly}
        candidateLevel={candidateLevel}
        state={state}
        onChange={onChange}
        onReset={onReset}
        onToggleRemote={onToggleRemote}
      />
      <VacanciesList
        total={total}
        items={filtered}
        now={now}
        selectedId={effectiveId}
        onSelect={onSelect}
        onReset={onReset}
      />
      <aside
        className={`vacancies-detail-col${mobileDetailOpen ? ' is-open' : ''}`}
        aria-label="Карточка вакансии"
      >
        {selectedItem ? (
          <VacancyDetailPanel item={selectedItem} now={now} applications={applications} onBack={onBack} />
        ) : null}
      </aside>
    </div>
  );
}

function VacanciesHeader({ primaryRole }: { readonly primaryRole?: string }) {
  return (
    <header className="career-view-heading">
      <div>
        <p className="career-eyebrow">{primaryRole ? `Кампания · ${primaryRole}` : 'Кампания'}</p>
        <h1>Вакансии</h1>
        <p className="vacancies-desc">
          Отсортировано по совпадению с профилем. Откройте карточку — решение «Откликнуться»
          принимается там же, без перехода на площадку.
        </p>
      </div>
    </header>
  );
}

function VacanciesFilters({
  roleHypotheses,
  regions,
  remoteOnly,
  candidateLevel,
  state,
  onChange,
  onReset,
  onToggleRemote,
}: {
  readonly roleHypotheses: NonNullable<CampaignMetaView['roleHypotheses']>;
  readonly regions: readonly string[];
  readonly remoteOnly: boolean;
  readonly candidateLevel?: string | null;
  readonly state: VacanciesScreenState;
  readonly onChange: (updater: (prev: VacanciesScreenState) => VacanciesScreenState) => void;
  readonly onReset: () => void;
  readonly onToggleRemote: () => void;
}) {
  return (
    <aside className="vacancies-filters" aria-label="Фильтры">
      <RoleHypothesesGroup roleHypotheses={roleHypotheses} state={state} onChange={onChange} />
      <RegionsGroup regions={regions} state={state} onChange={onChange} />
      <RemoteOnlyGroup remoteOnly={remoteOnly} onToggle={onToggleRemote} />

      {candidateLevel ? (
        <FieldGroup title="Уровень">
          <Chip label={candidateLevel} isSelected />
        </FieldGroup>
      ) : null}

      <FreshnessGroup state={state} onChange={onChange} />

      <button
        type="button"
        className="vacancies-btn vacancies-btn-secondary vacancies-reset"
        onClick={onReset}
      >
        Сбросить фильтры
      </button>
    </aside>
  );
}

function RemoteOnlyGroup({
  remoteOnly,
  onToggle,
}: {
  readonly remoteOnly: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <FieldGroup title="Формат работы">
      <Chip label="Удалённо" isSelected={remoteOnly} onClick={onToggle} />
    </FieldGroup>
  );
}

interface FilterGroupProps {
  readonly state: VacanciesScreenState;
  readonly onChange: (updater: (prev: VacanciesScreenState) => VacanciesScreenState) => void;
}

function RoleHypothesesGroup({
  roleHypotheses,
  state,
  onChange,
}: FilterGroupProps & { readonly roleHypotheses: NonNullable<CampaignMetaView['roleHypotheses']> }) {
  if (roleHypotheses.length === 0) return null;
  return (
    <FieldGroup title="Роль кампании">
      {roleHypotheses.map((hypothesis) => (
        <RoleChip
          key={hypothesis.role}
          role={hypothesis.role}
          vacancyCount={hypothesis.vacancyCount}
          isHypothesis={hypothesis.isHypothesis}
          isSelected={state.role === hypothesis.role}
          onSelect={() => onChange((prev) => ({ ...prev, role: hypothesis.role }))}
        />
      ))}
    </FieldGroup>
  );
}

function RegionsGroup({
  regions,
  state,
  onChange,
}: FilterGroupProps & { readonly regions: readonly string[] }) {
  if (regions.length === 0) return null;
  return (
    <FieldGroup title="География">
      {regions.map((region) => (
        <Chip
          key={region}
          label={region}
          isSelected={state.regions.includes(region)}
          onClick={() =>
            onChange((prev) => ({ ...prev, regions: toggleRegion(prev.regions, region) }))
          }
        />
      ))}
      <Chip
        label="Удалённо"
        isSelected={state.remoteOnly}
        onClick={() => onChange((prev) => ({ ...prev, remoteOnly: !prev.remoteOnly }))}
      />
    </FieldGroup>
  );
}

function FreshnessGroup({ state, onChange }: FilterGroupProps) {
  return (
    <FieldGroup title="Свежесть">
      {FRESHNESS_OPTIONS.map((option) => (
        <Chip
          key={option.days}
          label={option.label}
          isSelected={state.freshnessDays === option.days}
          onClick={() =>
            onChange((prev) => ({
              ...prev,
              freshnessDays: prev.freshnessDays === option.days ? undefined : option.days,
            }))
          }
        />
      ))}
    </FieldGroup>
  );
}

function VacanciesList({
  total,
  items,
  now,
  selectedId,
  onSelect,
  onReset,
}: {
  readonly total: number;
  readonly items: readonly MatchedVacancyItem[];
  readonly now: string;
  readonly selectedId?: string;
  readonly onSelect: (id: string) => void;
  readonly onReset: () => void;
}) {
  return (
    <section className="vacancies-list-col" aria-label="Список вакансий">
      <div className="vacancies-list-head">
        <span className="vacancies-list-hint">
          {pluralRu(total, ['вакансия', 'вакансии', 'вакансий'])} · показаны совпадающие по роли и
          уровню
        </span>
      </div>
      {items.length > 0 ? (
        <ul className="vac-list">
          {items.map((item) => (
            <VacancyRow
              key={item.cluster.id}
              item={item}
              now={now}
              isSelected={selectedId === item.cluster.id}
              onSelect={() => onSelect(item.cluster.id)}
            />
          ))}
        </ul>
      ) : (
        <div className="vacancies-filter-empty">
          <p>По выбранной роли и фильтрам совпадающих вакансий нет.</p>
          <button type="button" className="vacancies-btn vacancies-btn-secondary" onClick={onReset}>
            Сбросить фильтры
          </button>
        </div>
      )}
    </section>
  );
}

function toggleRegion(regions: readonly string[], region: string): readonly string[] {
  return regions.includes(region)
    ? regions.filter((entry) => entry !== region)
    : [...regions, region];
}

function filterByScreenState(
  items: readonly MatchedVacancyItem[],
  state: VacanciesScreenState,
  now: string,
): MatchedVacancyItem[] {
  return items.filter(({ cluster }) => {
    if (state.role && !titleMatchesRole(cluster.canonicalTitle, state.role)) return false;
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

function FieldGroup({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="vacancies-field-group">
      <h3>{title}</h3>
      <div className="vacancies-chip-row">{children}</div>
    </div>
  );
}

function Chip({
  label,
  isSelected,
  onClick,
}: {
  readonly label: string;
  readonly isSelected: boolean;
  readonly onClick?: () => void;
}) {
  if (!onClick) {
    return <span className={`vacancies-chip${isSelected ? ' is-selected' : ''}`}>{label}</span>;
  }

  return (
    <button
      type="button"
      className={`vacancies-chip${isSelected ? ' is-selected' : ''}`}
      aria-pressed={isSelected}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function RoleChip({
  role,
  vacancyCount,
  isHypothesis,
  isSelected,
  onSelect,
}: {
  readonly role: string;
  readonly vacancyCount: number;
  readonly isHypothesis: boolean;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`vacancies-chip vacancies-chip-accent${isSelected ? ' is-selected' : ''}${
        isHypothesis ? ' vacancies-chip-hypothesis' : ''
      }`}
      aria-pressed={isSelected}
      onClick={onSelect}
    >
      {role} ({vacancyCount})
      {isHypothesis ? ' — гипотеза' : ''}
    </button>
  );
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
