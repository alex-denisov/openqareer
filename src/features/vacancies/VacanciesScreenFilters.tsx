import { useEffect, useRef, useState } from 'react';
import { Check } from '@phosphor-icons/react';

import type {
  MatchedVacancyFacets,
  MatchedVacancySourceGroupId,
} from '../../../shared/matchedVacancyFacets';
import { getVacancySources, type VacancySourceRegistryEntry } from '../coach/coachApi';
import {
  VACANCY_FILTER_GROUPS,
  VacanciesFilterToolbarFromState,
  filterGroupMatches,
  type VacancyFilterGroup,
} from './VacanciesFilterToolbar';
import type { VacanciesScreenState } from './vacanciesScreenState';
export type { VacanciesScreenState } from './vacanciesScreenState';
import {
  candidateRegionLabel,
  isMobileFilterViewport,
  PremisesFilterSection,
  RoleFilterSection,
  VacanciesFilterPopover,
  VacancyFilterActions,
  useMobileRoleFocus,
} from './VacanciesFilterPopover';
import { LEVEL_HUMAN_NAMES } from './vacancyLevel';
import type { RoutePremisesDraft } from '../cabinet/routePremises';

export interface VacanciesScreenFiltersProps {
  readonly state: VacanciesScreenState;
  readonly facets?: MatchedVacancyFacets;
  readonly onChange: (updater: (prev: VacanciesScreenState) => VacanciesScreenState) => void;
  readonly onReset: () => void;
  readonly roleHypotheses?: ReadonlyArray<{
    role: string;
    vacancyCount?: number;
    isHypothesis: boolean;
  }>;
  readonly campaignRoles?: readonly string[];
  readonly regions?: readonly string[];
  readonly suggestedRegions?: readonly string[];
  readonly candidateLevel?: string;
  readonly onOpenProfileLevel?: () => void;
  readonly onAddCustomRole?: (title: string) => Promise<boolean>;
  readonly premises?: RoutePremisesDraft;
  readonly premisesLoading?: boolean;
  readonly onSavePremises?: (draft: RoutePremisesDraft) => Promise<void>;
  readonly focusRole?: boolean;
  readonly locations?: readonly FacetOption[];
  readonly salaryCurrencies?: readonly string[];
  readonly formatCounts?: Readonly<Record<string, number>>;
}

export function countActiveFilters(state: VacanciesScreenState): number {
  const groupIsActive = [
    Boolean(state.roles.length || state.levels?.length),
    Boolean(
      state.regions.length ||
      state.selectedCity ||
      state.selectedLocations?.length ||
      state.locationSearch?.trim(),
    ),
    Boolean(state.salaryMinimum !== undefined || state.salaryMaximum !== undefined),
    Boolean(state.remoteOnly || state.formats?.length),
    Boolean(state.sources?.length),
  ];
  return groupIsActive.filter(Boolean).length;
}

const LEVEL_LABELS: Readonly<Record<string, string>> = {
  ...LEVEL_HUMAN_NAMES,
  unknown: 'Неизвестно',
};

type SelectionField = 'roles' | 'regions' | 'levels' | 'sources' | 'formats';

interface FacetOption {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

function toggleValue(state: VacanciesScreenState, field: SelectionField, id: string) {
  const selected = state[field] ?? [];
  return {
    ...state,
    [field]: selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id],
  };
}

function FacetChip({
  option,
  selected,
  onClick,
}: {
  readonly option: FacetOption;
  readonly selected: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`chip-btn vacancies-chip vacancy-facet-chip${selected ? ' is-selected' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="vacancy-facet-chip-indicator" aria-hidden="true">
        {selected ? <Check className="vacancy-facet-chip-check" weight="bold" /> : null}
      </span>
      <span className="vacancy-facet-chip-copy">
        {option.label} · <span className="vacancy-facet-count">{option.count}</span>
      </span>
    </button>
  );
}

function FacetGroup({
  title,
  field,
  options,
  props,
}: {
  readonly title: string;
  readonly field: SelectionField;
  readonly options: readonly FacetOption[];
  readonly props: VacanciesScreenFiltersProps;
}) {
  if (!options.length) return null;
  return (
    <div className="field-group" data-filter-facet={field}>
      <h4>{title}</h4>
      <div className="chip-row">
        {options.map((option) => (
          <FacetChip
            key={option.id}
            option={option}
            selected={(props.state[field] ?? []).includes(option.id)}
            onClick={() => props.onChange((state) => toggleValue(state, field, option.id))}
          />
        ))}
      </div>
      {field === 'levels' ? <ProfileLevelNote /> : null}
    </div>
  );
}

function ProfileLevelNote() {
  return <p className="level-note">Уровень берётся из опыта в профиле</p>;
}

// География, удалённость, уровень и роль — из выдачи, с числами
function PrimaryFacetGroups({
  props,
  facets,
  activeGroup,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly facets: NonNullable<VacanciesScreenFiltersProps['facets']>;
  readonly activeGroup?: VacancyFilterGroup;
}) {
  return (
    <>
      {filterGroupMatches(activeGroup, 'roles') ? (
        <>
          <details className="vacancies-level-filter">
            <summary>Фильтр по уровню</summary>
            <FacetGroup
              title="Уровень"
              field="levels"
              props={props}
              options={facets.levels.map(({ level, count }) => ({
                id: level,
                label: LEVEL_LABELS[level],
                count,
              }))}
            />
          </details>
          <FacetGroup
            title="Роль"
            field="roles"
            props={props}
            options={facets.roles.map(({ role, count }) => ({ id: role, label: role, count }))}
          />
        </>
      ) : null}
      {filterGroupMatches(activeGroup, 'locations') ? (
        <FacetGroup
          title="География"
          field="regions"
          props={props}
          options={facets.regions.map(({ id, count }) => ({
            id,
            label: candidateRegionLabel(id),
            count,
          }))}
        />
      ) : null}
    </>
  );
}

function LocationFilterSearch({ props }: { readonly props: VacanciesScreenFiltersProps }) {
  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const locationSearch = event.currentTarget.value;
    props.onChange((state) => ({ ...state, locationSearch }));
  };
  return (
    <label className="career-field">
      <span>Страна, регион, штат или город</span>
      <input type="search" value={props.state.locationSearch ?? ''} onChange={onChange} />
    </label>
  );
}

function toggleSelectedLocation(state: VacanciesScreenState, id: string): VacanciesScreenState {
  const current = state.selectedLocations ?? [];
  return {
    ...state,
    selectedLocations: current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id],
  };
}

function LocationFilterChips({
  props,
  options,
  selected,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly options: readonly FacetOption[];
  readonly selected: readonly string[];
}) {
  return (
    <div className="chip-row">
      {options.map((option) => (
        <FacetChip
          key={option.id}
          option={option}
          selected={selected.includes(option.id)}
          onClick={() => props.onChange((state) => toggleSelectedLocation(state, option.id))}
        />
      ))}
    </div>
  );
}

function LocationFilterActions({
  remaining,
  showAll,
  hasSelection,
  onToggleShowAll,
  onClear,
}: {
  readonly remaining: number;
  readonly showAll: boolean;
  readonly hasSelection: boolean;
  readonly onToggleShowAll: () => void;
  readonly onClear: () => void;
}) {
  return (
    <>
      {remaining > 0 ? (
        <button type="button" className="filters-reset" onClick={onToggleShowAll}>
          {showAll ? 'Свернуть список локаций' : 'Ещё ' + remaining + ' локаций'}
        </button>
      ) : null}
      <button type="button" className="filters-reset" disabled={!hasSelection} onClick={onClear}>
        Снять все
      </button>
    </>
  );
}

function LocationFilterSection({ props }: { readonly props: VacanciesScreenFiltersProps }) {
  const [showAll, setShowAll] = useState(false);
  const options = props.locations ?? [];
  const query = props.state.locationSearch?.trim().toLocaleLowerCase('ru-RU') ?? '';
  const matches = options.filter(
    (option) => !query || option.label.toLocaleLowerCase('ru-RU').includes(query),
  );
  const visible = showAll ? matches : matches.slice(0, 8);
  const selected = props.state.selectedLocations ?? [];
  const clear = () =>
    props.onChange((state) => ({
      ...state,
      selectedLocations: [],
      selectedCity: undefined,
      regions: [],
      locationSearch: '',
    }));
  return (
    <div className="field-group vacancy-location-filter">
      <h4>Локации</h4>
      <LocationFilterSearch props={props} />
      <p className="vacancy-filter-result-count">
        Найти среди {matches.length} локаций в загруженных вакансиях
      </p>
      <LocationFilterChips props={props} options={visible} selected={selected} />
      <LocationFilterActions
        remaining={Math.max(0, matches.length - 8)}
        showAll={showAll}
        hasSelection={Boolean(selected.length || props.state.regions.length || query)}
        onToggleShowAll={() => setShowAll((value) => !value)}
        onClear={clear}
      />
    </div>
  );
}

function SalaryCurrencySelect({
  props,
  currencies,
  currency,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly currencies: readonly string[];
  readonly currency: string;
}) {
  const onChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const salaryCurrency = event.currentTarget.value;
    props.onChange((state) => ({ ...state, salaryCurrency }));
  };
  return (
    <label className="career-field">
      <span>Валюта</span>
      <select value={currency} onChange={onChange}>
        {currencies.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function updateSalaryAmount(
  props: VacanciesScreenFiltersProps,
  currency: string,
  field: 'salaryMinimum' | 'salaryMaximum',
  value: string,
) {
  props.onChange((state) => ({
    ...state,
    salaryCurrency: state.salaryCurrency ?? currency,
    [field]: value ? Number(value) : undefined,
  }));
}

function SalaryRangeFields({
  props,
  currency,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly currency: string;
}) {
  return (
    <div className="vacancy-salary-range">
      <label className="career-field">
        <span>От</span>
        <input
          type="number"
          min="0"
          value={props.state.salaryMinimum ?? ''}
          onChange={(event) =>
            updateSalaryAmount(props, currency, 'salaryMinimum', event.currentTarget.value)
          }
        />
      </label>
      <label className="career-field">
        <span>До</span>
        <input
          type="number"
          min="0"
          value={props.state.salaryMaximum ?? ''}
          onChange={(event) =>
            updateSalaryAmount(props, currency, 'salaryMaximum', event.currentTarget.value)
          }
        />
      </label>
    </div>
  );
}

function MissingSalaryToggle({ props }: { readonly props: VacanciesScreenFiltersProps }) {
  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const includeMissingSalary = event.currentTarget.checked;
    props.onChange((state) => ({ ...state, includeMissingSalary }));
  };
  return (
    <label className="vacancy-missing-salary-toggle">
      <input
        type="checkbox"
        checked={Boolean(props.state.includeMissingSalary)}
        onChange={onChange}
      />
      <span>Включать вакансии без этой зарплатной информации</span>
    </label>
  );
}

function SalaryFilterSection({ props }: { readonly props: VacanciesScreenFiltersProps }) {
  const currencies = props.salaryCurrencies ?? [];
  const currency = props.state.salaryCurrency ?? currencies[0] ?? '';
  const salaryRangeSet =
    props.state.salaryMinimum !== undefined || props.state.salaryMaximum !== undefined;
  return (
    <div className="field-group vacancy-salary-filter">
      <h4>Зарплата</h4>
      {currencies.length ? (
        <>
          <SalaryCurrencySelect props={props} currencies={currencies} currency={currency} />
          <SalaryRangeFields props={props} currency={currency} />
          {salaryRangeSet ? <MissingSalaryToggle props={props} /> : null}
        </>
      ) : (
        <p>В загруженных вакансиях зарплатные данные не указаны.</p>
      )}
    </div>
  );
}

function FormatFilterSection({ props }: { readonly props: VacanciesScreenFiltersProps }) {
  const hasFormatCounts = [props.facets?.remote, ...Object.values(props.formatCounts ?? {})].some(
    (count) => count !== undefined && count > 0,
  );
  const options = [
    { id: 'hybrid', label: 'Гибрид' },
    { id: 'office', label: 'В офисе' },
    { id: 'unknown', label: 'Не указано' },
  ];
  const remoteSelected = props.state.remoteOnly || (props.state.formats ?? []).includes('remote');
  return (
    <div className="field-group vacancy-format-filter">
      <h4>{hasFormatCounts ? 'Формат работы' : 'Формат'}</h4>
      <div className="chip-row">
        <FacetChip
          option={{
            id: 'remote',
            label: 'Удалённо',
            count: props.facets?.remote ?? props.formatCounts?.remote ?? 0,
          }}
          selected={remoteSelected}
          onClick={() =>
            props.onChange((state) => {
              const wasSelected = state.remoteOnly || (state.formats ?? []).includes('remote');
              return wasSelected
                ? {
                    ...state,
                    remoteOnly: false,
                    formats: (state.formats ?? []).filter((format) => format !== 'remote'),
                  }
                : { ...state, remoteOnly: true };
            })
          }
        />
        {options.map((option) => (
          <FacetChip
            key={option.id}
            option={{ ...option, count: props.formatCounts?.[option.id] ?? 0 }}
            selected={(props.state.formats ?? []).includes(option.id)}
            onClick={() => props.onChange((state) => toggleValue(state, 'formats', option.id))}
          />
        ))}
      </div>
    </div>
  );
}

function SourceFacetGroup({
  title,
  count,
  sources,
  props,
}: {
  readonly title: string;
  readonly count?: number;
  readonly sources: readonly {
    readonly sourceId: string;
    readonly name: string;
    readonly count: number;
  }[];
  readonly props: VacanciesScreenFiltersProps;
}) {
  if (!sources.length) return null;
  return (
    <fieldset className="vacancy-source-group">
      <legend>
        {title}
        {count === undefined ? '' : ' · ' + count}
      </legend>
      <div className="chip-row">
        {sources.map((source) => (
          <FacetChip
            key={source.sourceId}
            option={{ id: source.sourceId, label: source.name, count: source.count }}
            selected={(props.state.sources ?? []).includes(source.sourceId)}
            onClick={() =>
              props.onChange((state) => toggleValue(state, 'sources', source.sourceId))
            }
          />
        ))}
      </div>
    </fieldset>
  );
}

const SOURCE_GROUP_BY_CATEGORY: Readonly<Record<string, MatchedVacancySourceGroupId>> = {
  'ATS компаний': 'ats',
  'Агрегаторы и API': 'aggregators',
  'Международные площадки': 'platforms',
  'Telegram каналы': 'channels',
};

function useVacancySourceCatalog(): VacancySourceRegistryEntry[] {
  const [catalog, setCatalog] = useState<VacancySourceRegistryEntry[]>([]);
  useEffect(() => {
    let active = true;
    void getVacancySources()
      .then((sources) => {
        if (active) setCatalog(Array.isArray(sources) ? sources : []);
      })
      .catch(() => {
        if (active) setCatalog([]);
      });
    return () => {
      active = false;
    };
  }, []);
  return catalog;
}

function matchedSourceOptions(
  facets: MatchedVacancyFacets,
  catalog: readonly VacancySourceRegistryEntry[],
) {
  const sourceById = new Map<string, VacancySourceRegistryEntry>(
    catalog.map((source) => [source.id, source] as const),
  );
  return facets.sources.map(({ sourceId, name, count }) => {
    const source = sourceById.get(sourceId);
    return {
      sourceId,
      name: source?.name ?? name,
      groupId: source?.category ? (SOURCE_GROUP_BY_CATEGORY[source.category] ?? null) : null,
      count,
    };
  });
}

function SourceFacetGroups({ props }: { readonly props: VacanciesScreenFiltersProps }) {
  const catalog = useVacancySourceCatalog();
  const facets = props.facets;
  if (!facets) return null;
  const matchedSources = matchedSourceOptions(facets, catalog);
  if (!matchedSources.length) return null;
  const grouped = (facets.sourceGroups ?? []).map((group) => ({
    ...group,
    sources: matchedSources.filter((source) => source.groupId === group.id),
  }));
  const ungrouped = matchedSources.filter((source) => source.groupId === null);
  return (
    <div className="field-group vacancy-source-filter">
      <h4>Источники</h4>
      {grouped.map((group) => (
        <SourceFacetGroup
          key={group.id}
          title={group.name}
          count={group.count}
          sources={group.sources}
          props={props}
        />
      ))}
      <SourceFacetGroup title="Другие источники" sources={ungrouped} props={props} />
    </div>
  );
}

function FacetGroups({
  props,
  roleInputRef,
  activeGroup,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly roleInputRef?: React.Ref<HTMLInputElement>;
  readonly activeGroup?: VacancyFilterGroup;
}) {
  return (
    <>
      {props.facets ? (
        <PrimaryFacetGroups props={props} facets={props.facets} activeGroup={activeGroup} />
      ) : null}
      {filterGroupMatches(activeGroup, 'roles') ? (
        <details className="vacancies-custom-role-filter" open={Boolean(props.focusRole)}>
          <summary>Добавить свою роль</summary>
          <RoleFilterSection props={props} roleInputRef={roleInputRef} />
        </details>
      ) : null}
      {filterGroupMatches(activeGroup, 'locations') ? (
        <LocationFilterSection props={props} />
      ) : null}
      {filterGroupMatches(activeGroup, 'salary') ? <SalaryFilterSection props={props} /> : null}
      {filterGroupMatches(activeGroup, 'sources') ? <SourceFacetGroups props={props} /> : null}
      {filterGroupMatches(activeGroup, 'format') ? <FormatFilterSection props={props} /> : null}
    </>
  );
}

function emptyVacancyFilterState(): VacanciesScreenState {
  return {
    roles: [],
    regions: [],
    levels: [],
    sources: [],
    remoteOnly: false,
    selectedLocations: [],
    locationSearch: '',
    formats: [],
    salaryMinimum: undefined,
    salaryMaximum: undefined,
    salaryCurrency: undefined,
    includeMissingSalary: false,
    selectedCity: undefined,
  };
}

function useVacancyFilterDraft(props: VacanciesScreenFiltersProps) {
  const [expanded, setExpanded] = useState(() => Boolean(props.focusRole));
  const [draftState, setDraftState] = useState(props.state);
  const roleInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setDraftState(props.state), [props.state]);
  useEffect(() => {
    if (!props.focusRole) return;
    setExpanded(true);
    const timer = setTimeout(() => roleInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [props.focusRole]);
  const resetAll = () => {
    setDraftState(emptyVacancyFilterState());
    props.onReset();
  };
  const draftProps = { ...props, state: draftState, onChange: setDraftState, onReset: resetAll };
  return {
    expanded,
    setExpanded,
    draftProps,
    roleInputRef,
    resetAll,
    changed: JSON.stringify(draftState) !== JSON.stringify(props.state),
    apply: () => props.onChange(() => draftState),
  };
}

function VacancyFilterGroupContent({
  props,
  draftProps,
  activeGroup,
  roleInputRef,
  mobile,
  showPremises,
  onBackToOverview,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly draftProps: VacanciesScreenFiltersProps;
  readonly activeGroup: VacancyFilterGroup | null;
  readonly roleInputRef: ReturnType<typeof useVacancyFilterDraft>['roleInputRef'];
  readonly mobile: boolean;
  readonly showPremises: boolean;
  readonly onBackToOverview: () => void;
}) {
  return (
    <>
      {showPremises ? (
        <PremisesFilterSection
          premises={props.premises}
          premisesLoading={props.premisesLoading}
          onSavePremises={props.onSavePremises}
        />
      ) : null}
      {mobile && activeGroup !== null ? (
        <button
          type="button"
          className="filters-reset vacancies-filter-back"
          onClick={onBackToOverview}
        >
          Все фильтры
        </button>
      ) : null}
      <FacetGroups
        props={draftProps}
        roleInputRef={roleInputRef}
        activeGroup={activeGroup ?? undefined}
      />
    </>
  );
}

function VacancyFilterPopoverContent({
  props,
  model,
  activeGroup,
  onApply,
  onBackToOverview,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly model: ReturnType<typeof useVacancyFilterDraft>;
  readonly activeGroup: VacancyFilterGroup | null;
  readonly onApply: () => void;
  readonly onBackToOverview: () => void;
}) {
  const mobile = isMobileFilterViewport();
  const mobileOverview = mobile && activeGroup === null;
  const showPremises = !mobile && (activeGroup === null || activeGroup === 'roles');
  return (
    <>
      <VacancyFilterGroupContent
        props={props}
        draftProps={model.draftProps}
        activeGroup={activeGroup}
        roleInputRef={model.roleInputRef}
        mobile={mobile}
        showPremises={showPremises}
        onBackToOverview={onBackToOverview}
      />
      <VacancyFilterActions
        mobile={mobile}
        mobileOverview={mobileOverview}
        changed={model.changed}
        onReset={model.resetAll}
        onApply={onApply}
      />
    </>
  );
}

interface VacancyFilterPanelBodyProps {
  readonly props: VacanciesScreenFiltersProps;
  readonly model: ReturnType<typeof useVacancyFilterDraft>;
  readonly activeGroup: VacancyFilterGroup | null;
  readonly onSelectGroup: (group: VacancyFilterGroup) => void;
  readonly onTogglePanel: () => void;
  readonly onClose: () => void;
  readonly onApply: () => void;
  readonly onBackToOverview: () => void;
}

function VacancyFilterPanelBody({
  props,
  model,
  activeGroup,
  onSelectGroup,
  onTogglePanel,
  onClose,
  onApply,
  onBackToOverview,
}: VacancyFilterPanelBodyProps) {
  return (
    <div className="vacancies-filter-wrap">
      <VacanciesFilterToolbarFromState
        state={model.draftProps.state}
        expanded={model.expanded}
        activeGroup={activeGroup}
        onToggle={onTogglePanel}
        onSelectGroup={onSelectGroup}
      />
      <VacanciesFilterPopover
        title={VACANCY_FILTER_GROUPS.find(({ id }) => id === activeGroup)?.label ?? 'Фильтры'}
        activeGroup={activeGroup}
        open={model.expanded || activeGroup !== null}
        mobileOpen={model.expanded}
        onClose={onClose}
      >
        <VacancyFilterPopoverContent
          props={props}
          model={model}
          activeGroup={activeGroup}
          onApply={onApply}
          onBackToOverview={onBackToOverview}
        />
      </VacanciesFilterPopover>
    </div>
  );
}

function VacancyFilterPanel({
  props,
  model,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly model: ReturnType<typeof useVacancyFilterDraft>;
}) {
  const [activeGroup, setActiveGroup] = useState<VacancyFilterGroup | null>(null);
  useMobileRoleFocus(props.focusRole, setActiveGroup, model.setExpanded);
  const closePanel = () => {
    model.setExpanded(false);
    setActiveGroup(null);
  };
  const selectGroup = (group: VacancyFilterGroup) => {
    const next = activeGroup === group ? null : group;
    const mobile = isMobileFilterViewport();
    model.setExpanded(mobile && next !== null);
    setActiveGroup(next);
  };
  const togglePanel = () => {
    setActiveGroup(null);
    model.setExpanded((value) => !value);
  };
  return (
    <VacancyFilterPanelBody
      props={props}
      model={model}
      activeGroup={activeGroup}
      onSelectGroup={selectGroup}
      onTogglePanel={togglePanel}
      onClose={closePanel}
      onApply={() => {
        model.apply();
        closePanel();
      }}
      onBackToOverview={() => setActiveGroup(null)}
    />
  );
}

export function VacanciesFilters(props: VacanciesScreenFiltersProps) {
  const model = useVacancyFilterDraft(props);
  return <VacancyFilterPanel props={props} model={model} />;
}
