import { useEffect, useRef, useState } from 'react';
import { BookmarkSimple, Funnel } from '@phosphor-icons/react';
import type { MatchedVacancyFacets } from '../../../shared/matchedVacancyFacets';
import { CANDIDATE_REGION_CATALOGUE } from '../workspace/candidateRegions';
import { pluralRu } from '../../../shared/pluralRu';
import { VacancyAddRoleRow } from './VacancyAddRoleRow';
import { LEVEL_HUMAN_NAMES } from './vacancyLevel';
import { CareerRoutePremises } from '../cabinet/CareerRoutePremises';
import { CareerRoutePremisesEditor } from '../cabinet/CareerRoutePremisesEditor';
import type { RoutePremisesDraft } from '../cabinet/routePremises';

export interface VacanciesScreenState {
  readonly roles: readonly string[];
  readonly regions: readonly string[];
  readonly levels?: readonly string[];
  readonly sources?: readonly string[];
  readonly remoteOnly: boolean;
  readonly freshnessDays?: number;
  readonly selectedCity?: string;
}

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
  readonly savedSearchesCount?: number;
  readonly savedSearchesOpen?: boolean;
  readonly onToggleSavedSearches?: () => void;
  readonly onOpenProfileLevel?: () => void;
  readonly onAddCustomRole?: (title: string) => Promise<boolean>;
  readonly premises?: RoutePremisesDraft;
  readonly premisesLoading?: boolean;
  readonly onSavePremises?: (draft: RoutePremisesDraft) => Promise<void>;
  readonly focusRole?: boolean;
}

export function countActiveFilters(state: VacanciesScreenState): number {
  return (
    state.roles.length +
    state.regions.length +
    (state.levels?.length ?? 0) +
    (state.sources?.length ?? 0) +
    Number(state.remoteOnly) +
    Number(Boolean(state.selectedCity)) +
    Number(Boolean(state.freshnessDays))
  );
}

function regionLabel(id: string): string {
  return CANDIDATE_REGION_CATALOGUE.find((entry) => entry.id === id)?.label ?? id;
}

const LEVEL_LABELS: Readonly<Record<string, string>> = {
  ...LEVEL_HUMAN_NAMES,
  unknown: 'Неизвестно',
};

type SelectionField = 'roles' | 'regions' | 'levels' | 'sources';
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
      <span>
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
    <div className="field-group">
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

function RemoteGroup({ props }: { readonly props: VacanciesScreenFiltersProps }) {
  if (!props.facets?.remote) return null;
  return (
    <div className="field-group">
      <h4>Формат работы</h4>
      <div className="chip-row">
        <FacetChip
          option={{ id: 'remote', label: 'Удалённо', count: props.facets.remote }}
          selected={props.state.remoteOnly}
          onClick={() => props.onChange((state) => ({ ...state, remoteOnly: !state.remoteOnly }))}
        />
      </div>
    </div>
  );
}

function RoleFilterSection({
  props,
  roleInputRef,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly roleInputRef?: React.Ref<HTMLInputElement>;
}) {
  if (!props.onAddCustomRole) return null;
  return (
    <div className="field-group" data-testid="role-filter">
      <VacancyAddRoleRow
        roleCount={props.campaignRoles?.length ?? 0}
        onAddCustomRole={props.onAddCustomRole}
        inputRef={roleInputRef}
      />
    </div>
  );
}

function FacetGroups({
  props,
  roleInputRef,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly roleInputRef?: React.Ref<HTMLInputElement>;
}) {
  const facets = props.facets;
  return (
    <>
      {facets ? (
        <>
          <FacetGroup
            title="География"
            field="regions"
            props={props}
            options={facets.regions.map(({ id, count }) => ({
              id,
              label: regionLabel(id),
              count,
            }))}
          />
          <RemoteGroup props={props} />
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
          <FacetGroup
            title="Роль"
            field="roles"
            props={props}
            options={facets.roles.map(({ role, count }) => ({ id: role, label: role, count }))}
          />
        </>
      ) : null}
      <RoleFilterSection props={props} roleInputRef={roleInputRef} />
      {facets ? (
        <FacetGroup
          title="Источник"
          field="sources"
          props={props}
          options={facets.sources.map(({ sourceId, name, count }) => ({
            id: sourceId,
            label: name,
            count,
          }))}
        />
      ) : null}
    </>
  );
}

function SavedSearchesButton({ props }: { readonly props: VacanciesScreenFiltersProps }) {
  if (!props.onToggleSavedSearches) return null;
  return (
    <button
      type="button"
      className="saved-btn"
      aria-expanded={props.savedSearchesOpen}
      onClick={props.onToggleSavedSearches}
    >
      <BookmarkSimple weight="bold" aria-hidden="true" />
      <span>
        Сохранённые поиски
        {props.savedSearchesCount !== undefined ? (
          <>
            {' '}
            · <span className="vacancy-facet-count">{props.savedSearchesCount}</span>
          </>
        ) : null}
      </span>
    </button>
  );
}

function PremisesFilterSection({
  premises,
  premisesLoading,
  onSavePremises,
}: {
  readonly premises?: RoutePremisesDraft;
  readonly premisesLoading?: boolean;
  readonly onSavePremises?: (draft: RoutePremisesDraft) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  if (!premises) return null;
  if (editing) {
    return (
      <CareerRoutePremisesEditor
        initial={premises}
        saving={saving}
        error={error}
        onCancel={() => setEditing(false)}
        onSave={(draft) => {
          setSaving(true);
          setError(undefined);
          void onSavePremises?.(draft)
            .then(() => setEditing(false))
            .catch((reason: unknown) =>
              setError(reason instanceof Error ? reason.message : 'Не удалось сохранить.'),
            )
            .finally(() => setSaving(false));
        }}
      />
    );
  }
  return (
    <CareerRoutePremises
      targetRole={premises.targetRole}
      regions={premises.regions}
      workMode={premises.workMode ?? undefined}
      editDisabled={premisesLoading}
      onEdit={() => setEditing(true)}
    />
  );
}

function FiltersBar({
  expanded,
  onToggle,
  activeCount,
  onReset,
  props,
}: {
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly activeCount: number;
  readonly onReset: () => void;
  readonly props: VacanciesScreenFiltersProps;
}) {
  return (
    <div className="filters-bar">
      <button
        type="button"
        className="filters-toggle vacancies-mobile-filter-toggle"
        aria-expanded={expanded}
        aria-label="Фильтры и сохранённые запросы"
        onClick={onToggle}
      >
        <Funnel weight="bold" aria-hidden="true" />
        <span>Фильтры · {pluralRu(activeCount, ['активный', 'активных', 'активных'])}</span>
      </button>
      {activeCount > 0 ? (
        <button type="button" className="filters-reset" onClick={onReset}>
          Сбросить
        </button>
      ) : null}
      <SavedSearchesButton props={props} />
    </div>
  );
}

export function VacanciesFilters(props: VacanciesScreenFiltersProps) {
  const [expanded, setExpanded] = useState(() => Boolean(props.focusRole));
  const roleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (props.focusRole) {
      setExpanded(true);
      const timer = setTimeout(() => {
        roleInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [props.focusRole]);

  return (
    <>
      <FiltersBar
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
        activeCount={countActiveFilters(props.state)}
        onReset={props.onReset}
        props={props}
      />
      <div
        className={`filters-panel vacancies-filters${expanded ? ' is-expanded is-mobile-open' : ''}`}
        aria-label="Фильтры"
      >
        <div className="filters-panel-head">
          <h3>Фильтры</h3>
          <button type="button" className="filters-reset" onClick={() => setExpanded(false)}>
            Свернуть
          </button>
        </div>
        <PremisesFilterSection
          premises={props.premises}
          premisesLoading={props.premisesLoading}
          onSavePremises={props.onSavePremises}
        />
        <FacetGroups props={props} roleInputRef={roleInputRef} />
      </div>
    </>
  );
}
