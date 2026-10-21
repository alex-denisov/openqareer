import { useEffect, useMemo, useState } from 'react';
import { Check } from '@phosphor-icons/react';

import type { MatchedVacancyFacets } from '../../../shared/matchedVacancyFacets';
import {
  VACANCY_FILTER_GROUPS,
  VacanciesFilterToolbarFromState,
  withCampaignDefaults,
  filterGroupMatches,
  type VacancyFilterGroup,
} from './VacanciesFilterToolbar';
import type { VacanciesScreenState } from './vacanciesScreenState';
export type { VacanciesScreenState } from './vacanciesScreenState';
import {
  isMobileFilterViewport,
  VacanciesFilterPopover,
  VacancyFilterActions,
  mobileFilterValues,
  useRoleFocus,
} from './VacanciesFilterPopover';
import { VacancySourceCatalogFilter, useSourceCatalog } from './VacancySourceCatalogFilter';
import { MobileFilterSheet } from './VacanciesMobileFilterSheet';
import { VacancyFitSortControl } from './VacancyFitSort';
import { VacancyRoleFilter, type RoleOption } from './VacancyRoleFilter';
import type { RoutePremisesDraft } from '../cabinet/routePremises';
import { buildLocationTree } from '../../../shared/locationTree';
import type { LocationTreeBuilder } from './useLocationTreeForState';
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
  readonly locationTreeFor?: LocationTreeBuilder;
  /** Число выдачи для черновика; `undefined` — меняются серверные фильтры, число неизвестно. */
  readonly resultCountFor?: (state: VacanciesScreenState) => number | undefined;
  readonly salaryCurrencies?: readonly string[];
  readonly marketEstimateCount?: number;
  readonly formatCounts?: Readonly<Record<string, number>>;
}

export function countActiveFilters(state: VacanciesScreenState): number {
  const groupIsActive = [
    Boolean(state.roles.length || state.levels?.length),
    Boolean(
      state.regions.length ||
      state.selectedCity ||
      state.selectedCities?.length ||
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

function SalaryToggle({
  checked,
  label,
  onChange,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="vacancy-missing-salary-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

/** B546: both toggles change the list; the estimate one needs estimates to exist. */
function SalaryToggles({ props }: { readonly props: VacanciesScreenFiltersProps }) {
  const estimates = props.marketEstimateCount ?? 0;
  const byEstimate = Boolean(props.state.useMarketEstimate) && estimates > 0;
  return (
    <>
      <SalaryToggle
        checked={Boolean(props.state.includeMissingSalary)}
        label="Показывать вакансии без зарплаты"
        onChange={(includeMissingSalary) =>
          props.onChange((state) => ({ ...state, includeMissingSalary }))
        }
      />
      {estimates > 0 ? (
        <SalaryToggle
          checked={Boolean(props.state.useMarketEstimate)}
          label="Оценка рынка для вакансий без зарплаты"
          onChange={(useMarketEstimate) =>
            props.onChange((state) => ({ ...state, useMarketEstimate }))
          }
        />
      ) : (
        <p className="vacancy-salary-estimate-note">
          Оценка рынка по зарплате появится от 20 вакансий.
        </p>
      )}
      {byEstimate ? (
        <p className="vacancy-salary-estimate-note">
          Вакансии без зарплаты сравниваются по оценке рынка.
        </p>
      ) : null}
    </>
  );
}

function SalaryFilterSection({ props }: { readonly props: VacanciesScreenFiltersProps }) {
  const currencies = props.salaryCurrencies ?? [];
  const currency = props.state.salaryCurrency ?? currencies[0] ?? '';
  return (
    <div className="field-group vacancy-salary-filter">
      <h4>Зарплата</h4>
      {currencies.length ? (
        <>
          <SalaryCurrencySelect props={props} currencies={currencies} currency={currency} />
          <SalaryRangeFields props={props} currency={currency} />
          <SalaryToggles props={props} />
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

function SourceFacetGroups({
  props,
  withFooter,
  groupActions,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly withFooter: boolean;
  readonly groupActions: GroupActions;
}) {
  if (!props.facets || props.facets.sources.length === 0) return null;
  return (
    <VacancySourceCatalogFilter
      state={props.state}
      facets={props.facets}
      onChange={props.onChange}
      withFooter={withFooter}
      onCancel={groupActions.onCancel}
      onApply={groupActions.onApply}
    />
  );
}

interface GroupActions {
  readonly onCancel: () => void;
  readonly onApply: () => void;
}

const GROUPS_WITH_OWN_FOOTER = new Set<VacancyFilterGroup>(['roles', 'locations', 'sources']);

const EMPTY_LOCATION_TREE = buildLocationTree([]);

/** Дерево считается по черновику фильтров без локаций: так счётчик совпадёт со списком. */
function LocationTreeSection({
  props,
  withFooter,
  locationActions,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly withFooter: boolean;
  readonly locationActions: GroupActions;
}) {
  const { selectedLocations, locationRemote, locationSearch, ...rest } = props.state;
  const otherFilters = JSON.stringify(rest);
  const { locationTreeFor } = props;
  const tree = useMemo(
    () => locationTreeFor?.(JSON.parse(otherFilters)) ?? EMPTY_LOCATION_TREE,
    [locationTreeFor, otherFilters],
  );
  return (
    <VacancyLocationTreeFilter
      withFooter={withFooter}
      state={props.state}
      tree={tree}
      onChange={props.onChange}
      onCancel={locationActions.onCancel}
      onApply={locationActions.onApply}
    />
  );
}

function roleOptions(props: VacanciesScreenFiltersProps): RoleOption[] {
  const counts = new Map(props.facets?.roles.map(({ role, count }) => [role, count]));
  const hypothesisCounts = new Map(
    props.roleHypotheses?.map(({ role, vacancyCount }) => [role, vacancyCount]),
  );
  const roles = props.campaignRoles?.length
    ? props.campaignRoles
    : (props.facets?.roles.map(({ role }) => role) ?? []);
  return roles.map((role) => ({ role, count: counts.get(role) ?? hypothesisCounts.get(role) }));
}

function pendingHypotheses(props: VacanciesScreenFiltersProps): string[] {
  const roles = new Set(props.campaignRoles ?? []);
  return (props.roleHypotheses ?? [])
    .filter(({ role, isHypothesis }) => isHypothesis && !roles.has(role))
    .map(({ role }) => role);
}

function FacetGroups({
  props,
  activeGroup,
  groupActions,
  mobile = false,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly activeGroup?: VacancyFilterGroup;
  readonly groupActions: GroupActions;
  readonly mobile?: boolean;
}) {
  const withFooter = (group: VacancyFilterGroup) => activeGroup === group && !mobile;
  return (
    <>
      {filterGroupMatches(activeGroup, 'roles') ? (
        <VacancyRoleFilter
          state={props.state}
          roles={roleOptions(props)}
          pendingHypotheses={pendingHypotheses(props)}
          onChange={props.onChange}
          withFooter={withFooter('roles')}
          onCancel={groupActions.onCancel}
          onApply={groupActions.onApply}
        />
      ) : null}
      {filterGroupMatches(activeGroup, 'locations') ? (
        <LocationTreeSection
          props={props}
          withFooter={withFooter('locations')}
          locationActions={groupActions}
        />
      ) : null}
      {filterGroupMatches(activeGroup, 'salary') ? <SalaryFilterSection props={props} /> : null}
      {filterGroupMatches(activeGroup, 'sources') ? (
        <SourceFacetGroups
          props={props}
          withFooter={withFooter('sources')}
          groupActions={groupActions}
        />
      ) : null}
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
    selectedCities: [],
  };
}

function useVacancyFilterDraft(props: VacanciesScreenFiltersProps) {
  const [expanded, setExpanded] = useState(false);
  const [draftState, setDraftState] = useState(props.state);
  useEffect(() => setDraftState(props.state), [props.state]);
  const resetAll = () => {
    setDraftState(emptyVacancyFilterState());
    props.onReset();
  };
  const draftProps = { ...props, state: draftState, onChange: setDraftState, onReset: resetAll };
  return {
    expanded,
    setExpanded,
    draftProps,
    resetAll,
    changed: JSON.stringify(draftState) !== JSON.stringify(props.state),
    discard: () => setDraftState(props.state),
    apply: () => props.onChange(() => draftState),
  };
}

function sheetSubtitle(
  facets: VacanciesScreenFiltersProps['facets'],
  resultCount: number | undefined,
): string | undefined {
  if (!facets) return undefined;
  const format = (value: number) => new Intl.NumberFormat('ru-RU').format(value);
  const summary = facets.catalogSummary;
  const pool =
    summary?.catalogTotal !== undefined
      ? `${format(summary.roleLevelMatches)} из ${format(summary.catalogTotal)} вакансий каталога подходят по роли и уровню.`
      : `${format(facets.total)} вакансий в подборке по роли и уровню.`;
  return resultCount === undefined ? pool : `${pool} С вашими условиями — ${format(resultCount)}.`;
}

function MobileFilterSheetContent({
  props,
  model,
  activeGroup,
  onSelectGroup,
  onApply,
  onBackToOverview,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly model: ReturnType<typeof useVacancyFilterDraft>;
  readonly activeGroup: VacancyFilterGroup | null;
  readonly onSelectGroup: (group: VacancyFilterGroup) => void;
  readonly onApply: () => void;
  readonly onBackToOverview: () => void;
}) {
  const catalog = useSourceCatalog();
  const draft = model.draftProps.state;
  const resultCount = props.resultCountFor?.(draft);
  return (
    <MobileFilterSheet
      activeGroup={activeGroup}
      values={mobileFilterValues(
        withCampaignDefaults(draft, props.campaignRoles, props.regions),
        catalog.sources.length,
      )}
      subtitle={sheetSubtitle(props.facets, resultCount)}
      resultCount={resultCount}
      onSelectGroup={onSelectGroup}
      onBack={onBackToOverview}
      onReset={model.resetAll}
      onShow={onApply}
      sortControl={
        <VacancyFitSortControl
          value={draft.sort}
          onChange={(sort) => model.draftProps.onChange((previous) => ({ ...previous, sort }))}
        />
      }
    >
      <FacetGroups
        props={model.draftProps}
        activeGroup={activeGroup ?? undefined}
        mobile
        groupActions={{ onApply, onCancel: onBackToOverview }}
      />
    </MobileFilterSheet>
  );
}

function VacancyFilterPopoverContent({
  props,
  model,
  activeGroup,
  onSelectGroup,
  onApply,
  onBackToOverview,
  onClose,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly model: ReturnType<typeof useVacancyFilterDraft>;
  readonly activeGroup: VacancyFilterGroup | null;
  readonly onSelectGroup: (group: VacancyFilterGroup) => void;
  readonly onApply: () => void;
  readonly onBackToOverview: () => void;
  readonly onClose: () => void;
}) {
  if (isMobileFilterViewport())
    return (
      <MobileFilterSheetContent
        props={props}
        model={model}
        activeGroup={activeGroup}
        onSelectGroup={onSelectGroup}
        onApply={onApply}
        onBackToOverview={onBackToOverview}
      />
    );
  return (
    <>
      <FacetGroups
        props={model.draftProps}
        activeGroup={activeGroup ?? undefined}
        groupActions={{
          onApply,
          onCancel: () => {
            model.discard();
            onClose();
          },
        }}
      />
      {activeGroup && GROUPS_WITH_OWN_FOOTER.has(activeGroup) ? null : (
        <VacancyFilterActions changed={model.changed} onReset={model.resetAll} onApply={onApply} />
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
        state={withCampaignDefaults(model.draftProps.state, props.campaignRoles, props.regions)}
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
          onSelectGroup={onSelectGroup}
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
  useRoleFocus(props.focusRole, setActiveGroup, model.setExpanded);
  const closePanel = () => {
    model.discard();
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
