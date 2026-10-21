import { useEffect, useRef, useState } from 'react';
import { Check } from '@phosphor-icons/react';

import type { MatchedVacancyFacets } from '../../../shared/matchedVacancyFacets';
import {
  VACANCY_FILTER_GROUPS,
  VacanciesFilterToolbarFromState,
  filterGroupMatches,
  type VacancyFilterGroup,
} from './VacanciesFilterToolbar';
import type { VacanciesScreenState } from './vacanciesScreenState';
export type { VacanciesScreenState } from './vacanciesScreenState';
import {
  isMobileFilterViewport,
  PremisesFilterSection,
  RoleFilterSection,
  VacanciesFilterPopover,
  VacancyFilterActions,
  useMobileRoleFocus,
} from './VacanciesFilterPopover';
import { LEVEL_HUMAN_NAMES } from './vacancyLevel';
import { VacancySourceCatalogFilter } from './VacancySourceCatalogFilter';
import type { RoutePremisesDraft } from '../cabinet/routePremises';
import { buildLocationTree, type LocationTree } from '../../../shared/locationTree';
import { VacancyLocationTreeFilter } from './VacancyLocationTreeFilter';

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
  readonly locationTree?: LocationTree;
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
      state.locationRemote ||
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
    </>
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

function SourceFacetGroups({ props }: { readonly props: VacanciesScreenFiltersProps }) {
  if (!props.facets || props.facets.sources.length === 0) return null;
  return (
    <VacancySourceCatalogFilter
      state={props.state}
      facets={props.facets}
      onChange={props.onChange}
    />
  );
}

interface LocationActions {
  readonly onCancel: () => void;
  readonly onApply: () => void;
}

const EMPTY_LOCATION_TREE = buildLocationTree([]);

function FacetGroups({
  props,
  roleInputRef,
  activeGroup,
  locationActions,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly roleInputRef?: React.Ref<HTMLInputElement>;
  readonly activeGroup?: VacancyFilterGroup;
  readonly locationActions: LocationActions;
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
        <VacancyLocationTreeFilter
          withFooter={activeGroup === 'locations'}
          state={props.state}
          tree={props.locationTree ?? EMPTY_LOCATION_TREE}
          onChange={props.onChange}
          onCancel={locationActions.onCancel}
          onApply={locationActions.onApply}
        />
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
    locationRemote: false,
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
    cancelLocations: () =>
      setDraftState((draft) => ({
        ...draft,
        selectedLocations: props.state.selectedLocations,
        locationRemote: props.state.locationRemote,
      })),
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
  locationActions,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly locationActions: LocationActions;
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
        locationActions={locationActions}
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
  onClose,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly model: ReturnType<typeof useVacancyFilterDraft>;
  readonly activeGroup: VacancyFilterGroup | null;
  readonly onApply: () => void;
  readonly onBackToOverview: () => void;
  readonly onClose: () => void;
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
        locationActions={{
          onApply,
          onCancel: () => {
            model.cancelLocations();
            if (mobile) onBackToOverview();
            else onClose();
          },
        }}
      />
      {activeGroup === 'locations' ? null : (
        <VacancyFilterActions
          mobile={mobile}
          mobileOverview={mobileOverview}
          changed={model.changed}
          onReset={model.resetAll}
          onApply={onApply}
        />
      )}
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
          onClose={onClose}
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
