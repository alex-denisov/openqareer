import { useState } from 'react';
import { BookmarkSimple, Funnel, Plus, X } from '@phosphor-icons/react';
import { CANDIDATE_REGION_CATALOGUE } from '../workspace/candidateRegions';
import { pluralRu } from '../../../shared/pluralRu';

export interface VacanciesScreenState {
  /** Пусто = «Все роли кампании» (по умолчанию); иначе — мультивыбор. */
  readonly roles: readonly string[];
  readonly regions: readonly string[];
  readonly remoteOnly: boolean;
  readonly freshnessDays?: number;
  readonly selectedCity?: string;
}

export interface VacanciesScreenFiltersProps {
  readonly state: VacanciesScreenState;
  readonly onChange: (updater: (prev: VacanciesScreenState) => VacanciesScreenState) => void;
  readonly onReset: () => void;
  readonly roleHypotheses: ReadonlyArray<{
    role: string;
    vacancyCount?: number;
    isHypothesis: boolean;
  }>;
  readonly campaignRoles?: readonly string[];
  readonly regions: readonly string[];
  readonly suggestedRegions?: readonly string[];
  readonly candidateLevel?: string;
  readonly savedSearchesCount?: number;
  readonly savedSearchesOpen?: boolean;
  readonly onToggleSavedSearches?: () => void;
  readonly onOpenProfileLevel?: () => void;
  readonly onAddCustomRole?: (title: string) => Promise<boolean>;
}

export function countActiveFilters(state: VacanciesScreenState): number {
  return (
    state.roles.length +
    state.regions.length +
    (state.remoteOnly ? 1 : 0) +
    (state.selectedCity ? 1 : 0) +
    (state.freshnessDays ? 1 : 0)
  );
}

function regionLabel(id: string): string {
  const found = CANDIDATE_REGION_CATALOGUE.find((opt) => opt.id === id);
  return found?.label ?? id;
}

interface RoleEntry {
  role: string;
  vacancyCount?: number;
  isHypothesis: boolean;
}

function buildRolesMap(
  campaignRoles: readonly string[],
  roleHypotheses: VacanciesScreenFiltersProps['roleHypotheses'],
): Map<string, RoleEntry> {
  const map = new Map<string, RoleEntry>();
  for (const role of campaignRoles) {
    map.set(role, { role, isHypothesis: false });
  }
  for (const hyp of roleHypotheses) {
    const existing = map.get(hyp.role);
    map.set(hyp.role, {
      role: hyp.role,
      vacancyCount: hyp.vacancyCount,
      isHypothesis: existing ? existing.isHypothesis : hyp.isHypothesis,
    });
  }
  return map;
}

function useAddRole(
  onAddCustomRole?: (title: string) => Promise<boolean>,
  isLimitReached?: boolean,
) {
  const [newRoleTitle, setNewRoleTitle] = useState('');
  const [savingRole, setSavingRole] = useState(false);

  const handleAddRole = async () => {
    const trimmed = newRoleTitle.trim();
    if (!trimmed || isLimitReached || savingRole) return;
    setSavingRole(true);
    try {
      const ok = await onAddCustomRole?.(trimmed);
      if (ok) setNewRoleTitle('');
    } finally {
      setSavingRole(false);
    }
  };

  return { newRoleTitle, setNewRoleTitle, savingRole, handleAddRole };
}

function RoleChips({
  roles,
  rolesMap,
  onChange,
}: {
  readonly roles: readonly string[];
  readonly rolesMap: Map<string, RoleEntry>;
  readonly onChange: VacanciesScreenFiltersProps['onChange'];
}) {
  return (
    <>
      {roles.map((role) => {
        const isHypo = rolesMap.get(role)?.isHypothesis;
        return (
          <span key={role} className={`chip is-accent${isHypo ? ' is-hypothesis' : ''}`}>
            <span>{role}</span>
            <button
              type="button"
              className="chip-x"
              aria-label="Убрать роль"
              onClick={() =>
                onChange((prev: VacanciesScreenState) => ({
                  ...prev,
                  roles: prev.roles.filter((r: string) => r !== role),
                }))
              }
            >
              <X size={12} weight="bold" aria-hidden="true" />
            </button>
          </span>
        );
      })}
    </>
  );
}

function CityChip({
  city,
  onClear,
}: {
  readonly city?: string;
  readonly onClear: () => void;
}) {
  if (!city) return null;
  return (
    <span className="chip is-accent">
      <span>{city}</span>
      <button type="button" className="chip-x" aria-label="Убрать фильтр" onClick={onClear}>
        <X size={12} weight="bold" aria-hidden="true" />
      </button>
    </span>
  );
}

function RemoteChip({
  remoteOnly,
  onClear,
}: {
  readonly remoteOnly: boolean;
  readonly onClear: () => void;
}) {
  if (!remoteOnly) return null;
  return (
    <span className="chip">
      <span>Удалённо</span>
      <button type="button" className="chip-x" aria-label="Убрать фильтр" onClick={onClear}>
        <X size={12} weight="bold" aria-hidden="true" />
      </button>
    </span>
  );
}

function LocationChips({
  selectedCity,
  regions,
  remoteOnly,
  onChange,
}: {
  readonly selectedCity?: string;
  readonly regions: readonly string[];
  readonly remoteOnly: boolean;
  readonly onChange: VacanciesScreenFiltersProps['onChange'];
}) {
  return (
    <>
      <CityChip
        city={selectedCity}
        onClear={() => onChange((prev) => ({ ...prev, selectedCity: undefined }))}
      />

      {regions.map((region) => (
        <span key={region} className="chip">
          <span>{regionLabel(region)}</span>
          <button
            type="button"
            className="chip-x"
            aria-label="Убрать фильтр"
            onClick={() =>
              onChange((prev: VacanciesScreenState) => ({
                ...prev,
                regions: prev.regions.filter((entry: string) => entry !== region),
              }))
            }
          >
            <X size={12} weight="bold" aria-hidden="true" />
          </button>
        </span>
      ))}

      <RemoteChip
        remoteOnly={remoteOnly}
        onClear={() => onChange((prev) => ({ ...prev, remoteOnly: false }))}
      />
    </>
  );
}

interface ActiveChipsProps {
  readonly state: VacanciesScreenState;
  readonly rolesMap: Map<string, RoleEntry>;
  readonly candidateLevel?: string;
  readonly onChange: VacanciesScreenFiltersProps['onChange'];
}

function ActiveFilterChips({ state, rolesMap, candidateLevel, onChange }: ActiveChipsProps) {
  return (
    <div className="active-chips">
      <RoleChips roles={state.roles} rolesMap={rolesMap} onChange={onChange} />
      <LocationChips
        selectedCity={state.selectedCity}
        regions={state.regions}
        remoteOnly={state.remoteOnly}
        onChange={onChange}
      />
      {candidateLevel ? (
        <span className="chip">
          <span>{candidateLevel}</span>
        </span>
      ) : null}
    </div>
  );
}

function SavedSearchesButton({
  count,
  open,
  onToggle,
}: {
  readonly count?: number;
  readonly open?: boolean;
  readonly onToggle?: () => void;
}) {
  if (!onToggle) return null;
  return (
    <button type="button" className="saved-btn" aria-expanded={open} onClick={onToggle}>
      <BookmarkSimple size={14} weight="bold" aria-hidden="true" />
      <span>{`Сохранённые поиски${count !== undefined ? ` · ${count}` : ''}`}</span>
    </button>
  );
}

interface FiltersBarProps {
  readonly expanded: boolean;
  readonly activeCount: number;
  readonly state: VacanciesScreenState;
  readonly rolesMap: Map<string, RoleEntry>;
  readonly candidateLevel?: string;
  readonly savedSearchesCount?: number;
  readonly savedSearchesOpen?: boolean;
  readonly onToggle: () => void;
  readonly onChange: VacanciesScreenFiltersProps['onChange'];
  readonly onReset: () => void;
  readonly onToggleSavedSearches?: () => void;
}

function FiltersBar({
  expanded,
  activeCount,
  state,
  rolesMap,
  candidateLevel,
  savedSearchesCount,
  savedSearchesOpen,
  onToggle,
  onChange,
  onReset,
  onToggleSavedSearches,
}: FiltersBarProps) {
  const filterLabel = `Фильтры · ${pluralRu(activeCount, ['активный', 'активных', 'активных'])}`;

  return (
    <div className="filters-bar">
      <button
        type="button"
        className="filters-toggle vacancies-mobile-filter-toggle"
        aria-expanded={expanded}
        aria-label="Фильтры и сохранённые запросы"
        onClick={onToggle}
      >
        <Funnel size={14} weight="bold" aria-hidden="true" />
        <span>{filterLabel}</span>
      </button>

      <ActiveFilterChips
        state={state}
        rolesMap={rolesMap}
        candidateLevel={candidateLevel}
        onChange={onChange}
      />

      {activeCount > 0 ? (
        <button type="button" className="filters-reset" onClick={onReset}>
          Сбросить
        </button>
      ) : null}

      <SavedSearchesButton
        count={savedSearchesCount}
        open={savedSearchesOpen}
        onToggle={onToggleSavedSearches}
      />
    </div>
  );
}

function AddRoleRow({
  addRoleState,
  isLimitReached,
}: {
  readonly addRoleState: ReturnType<typeof useAddRole>;
  readonly isLimitReached: boolean;
}) {
  const { newRoleTitle, setNewRoleTitle, savingRole, handleAddRole } = addRoleState;
  return (
    <div className="add-role-row">
      <input
        className="add-role-input"
        type="text"
        placeholder="Своя формулировка роли…"
        aria-label="Добавить свою роль"
        disabled={isLimitReached || savingRole}
        value={newRoleTitle}
        onChange={(e) => setNewRoleTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void handleAddRole();
          }
        }}
      />
      <button
        type="button"
        className="btn btn-secondary"
        disabled={isLimitReached || !newRoleTitle.trim() || savingRole}
        onClick={() => void handleAddRole()}
      >
        <Plus size={16} weight="bold" aria-hidden="true" />
        <span>Добавить роль</span>
      </button>
    </div>
  );
}

function RoleButtonsRow({
  allRoles,
  selectedRoles,
  onChange,
}: {
  readonly allRoles: RoleEntry[];
  readonly selectedRoles: readonly string[];
  readonly onChange: VacanciesScreenFiltersProps['onChange'];
}) {
  const isAll = selectedRoles.length === 0;
  return (
    <div className="chip-row">
      <button
        type="button"
        className={`chip-btn vacancies-chip vacancies-chip-accent${isAll ? ' is-selected' : ''}`}
        aria-pressed={isAll}
        onClick={() => onChange((prev) => ({ ...prev, roles: [] }))}
      >
        Все роли кампании
      </button>
      {allRoles.map((roleItem) => {
        const isSelected = selectedRoles.includes(roleItem.role);
        return (
          <button
            key={roleItem.role}
            type="button"
            className={`chip-btn vacancies-chip vacancies-chip-accent${
              isSelected ? ' is-selected' : ''
            }${roleItem.isHypothesis ? ' is-hypothesis vacancies-chip-hypothesis' : ''}`}
            aria-pressed={isSelected}
            onClick={() =>
              onChange((prev: VacanciesScreenState) => ({
                ...prev,
                roles: isSelected
                  ? prev.roles.filter((r: string) => r !== roleItem.role)
                  : [...prev.roles, roleItem.role],
              }))
            }
          >
            <span>
              {roleItem.role}
              {roleItem.vacancyCount !== undefined ? ` (${roleItem.vacancyCount})` : ''}
              {roleItem.isHypothesis ? ' — гипотеза' : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface RoleGroupProps {
  readonly allRoles: RoleEntry[];
  readonly selectedRoles: readonly string[];
  readonly isLimitReached: boolean;
  readonly addRoleState: ReturnType<typeof useAddRole>;
  readonly onChange: VacanciesScreenFiltersProps['onChange'];
}

function FilterRoleGroup({
  allRoles,
  selectedRoles,
  isLimitReached,
  addRoleState,
  onChange,
}: RoleGroupProps) {
  return (
    <div className="field-group">
      <h4>Роль кампании</h4>
      <RoleButtonsRow allRoles={allRoles} selectedRoles={selectedRoles} onChange={onChange} />
      <AddRoleRow addRoleState={addRoleState} isLimitReached={isLimitReached} />
      <p className={`role-limit-note${isLimitReached ? ' is-warning' : ''}`}>
        {isLimitReached
          ? 'Достигнут предел — 10 из 10 ролей. Уберите одну, чтобы добавить другую.'
          : `${allRoles.length} из 10 ролей`}
      </p>
    </div>
  );
}

interface GeoGroupProps {
  readonly visibleRegions: readonly string[];
  readonly unselectedSuggested: readonly string[];
  readonly selectedRegions: readonly string[];
  readonly onChange: VacanciesScreenFiltersProps['onChange'];
}

function FilterGeoGroup({
  visibleRegions,
  unselectedSuggested,
  selectedRegions,
  onChange,
}: GeoGroupProps) {
  return (
    <div className="field-group">
      <h4>География</h4>
      <div className="chip-row">
        {visibleRegions.map((region) => (
          <button
            key={region}
            type="button"
            className={`chip-btn vacancies-chip${selectedRegions.includes(region) ? ' is-selected' : ''}`}
            aria-pressed={selectedRegions.includes(region)}
            onClick={() =>
              onChange((prev: VacanciesScreenState) => ({
                ...prev,
                regions: prev.regions.includes(region)
                  ? prev.regions.filter((entry: string) => entry !== region)
                  : [...prev.regions, region],
              }))
            }
          >
            <span>{regionLabel(region)}</span>
          </button>
        ))}
        {unselectedSuggested.map((reg) => (
          <button
            key={`suggested-${reg}`}
            type="button"
            className="chip-btn vacancies-chip vacancies-chip-suggested"
            onClick={() =>
              onChange((prev) => ({
                ...prev,
                regions: [...prev.regions, reg],
              }))
            }
          >
            <span>Добавить: {regionLabel(reg)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterFormatGroup({
  remoteOnly,
  onChange,
}: {
  readonly remoteOnly: boolean;
  readonly onChange: VacanciesScreenFiltersProps['onChange'];
}) {
  return (
    <div className="field-group">
      <h4>Формат работы</h4>
      <div className="chip-row">
        <button
          type="button"
          className={`chip-btn vacancies-chip${remoteOnly ? ' is-selected' : ''}`}
          aria-pressed={remoteOnly}
          onClick={() => onChange((prev) => ({ ...prev, remoteOnly: !prev.remoteOnly }))}
        >
          <span>Удалённо</span>
        </button>
      </div>
    </div>
  );
}

function FilterLevelGroup({
  candidateLevel,
  onOpenProfileLevel,
}: {
  readonly candidateLevel?: string;
  readonly onOpenProfileLevel?: () => void;
}) {
  if (!candidateLevel) return null;
  return (
    <div className="field-group">
      <h4>Уровень</h4>
      <div className="chip-row">
        <span className="chip is-selected">
          <span>{candidateLevel}</span>
        </span>
        <span className="level-note">
          из профиля ·{' '}
          {onOpenProfileLevel ? (
            <button type="button" onClick={onOpenProfileLevel}>
              изменить в профиле
            </button>
          ) : (
            <a href="#profile">изменить в профиле</a>
          )}
        </span>
      </div>
    </div>
  );
}

interface FilterPanelProps {
  readonly expanded: boolean;
  readonly onClose: () => void;
  readonly roleGroupProps: RoleGroupProps;
  readonly geoGroupProps: GeoGroupProps;
  readonly remoteOnly: boolean;
  readonly candidateLevel?: string;
  readonly onOpenProfileLevel?: () => void;
  readonly onChange: VacanciesScreenFiltersProps['onChange'];
}

function FiltersPanel({
  expanded,
  onClose,
  roleGroupProps,
  geoGroupProps,
  remoteOnly,
  candidateLevel,
  onOpenProfileLevel,
  onChange,
}: FilterPanelProps) {
  return (
    <div
      className={`filters-panel vacancies-filters${expanded ? ' is-expanded is-mobile-open' : ''}`}
      aria-label="Фильтры"
    >
      <div className="filters-panel-head">
        <h3>Фильтры</h3>
        <button type="button" className="filters-reset" onClick={onClose}>
          Свернуть
        </button>
      </div>

      <FilterRoleGroup {...roleGroupProps} />
      <FilterGeoGroup {...geoGroupProps} />
      <FilterFormatGroup remoteOnly={remoteOnly} onChange={onChange} />
      <FilterLevelGroup
        candidateLevel={candidateLevel}
        onOpenProfileLevel={onOpenProfileLevel}
      />
    </div>
  );
}

function useFiltersSetup(props: VacanciesScreenFiltersProps) {
  const rolesMap = buildRolesMap(props.campaignRoles ?? [], props.roleHypotheses);
  const allRoles = Array.from(rolesMap.values());
  const isLimitReached = allRoles.length >= 10;
  const addRoleState = useAddRole(props.onAddCustomRole, isLimitReached);

  const visibleRegions = Array.from(new Set([...props.regions, ...props.state.regions]));
  const unselectedSuggested = (props.suggestedRegions ?? []).filter(
    (reg) => !visibleRegions.includes(reg) && !visibleRegions.includes(regionLabel(reg)),
  );

  return { rolesMap, allRoles, isLimitReached, addRoleState, visibleRegions, unselectedSuggested };
}

export function VacanciesFilters(props: VacanciesScreenFiltersProps) {
  const [expanded, setExpanded] = useState(false);
  const setup = useFiltersSetup(props);

  return (
    <>
      <FiltersBar
        expanded={expanded}
        activeCount={countActiveFilters(props.state)}
        state={props.state}
        rolesMap={setup.rolesMap}
        candidateLevel={props.candidateLevel}
        savedSearchesCount={props.savedSearchesCount}
        savedSearchesOpen={props.savedSearchesOpen}
        onToggle={() => setExpanded((prev) => !prev)}
        onChange={props.onChange}
        onReset={props.onReset}
        onToggleSavedSearches={props.onToggleSavedSearches}
      />

      <FiltersPanel
        expanded={expanded}
        onClose={() => setExpanded(false)}
        roleGroupProps={{
          allRoles: setup.allRoles,
          selectedRoles: props.state.roles,
          isLimitReached: setup.isLimitReached,
          addRoleState: setup.addRoleState,
          onChange: props.onChange,
        }}
        geoGroupProps={{
          visibleRegions: setup.visibleRegions,
          unselectedSuggested: setup.unselectedSuggested,
          selectedRegions: props.state.regions,
          onChange: props.onChange,
        }}
        remoteOnly={props.state.remoteOnly}
        candidateLevel={props.candidateLevel}
        onOpenProfileLevel={props.onOpenProfileLevel}
        onChange={props.onChange}
      />
    </>
  );
}
