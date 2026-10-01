import { useState } from 'react';
import { BookmarkSimple, Funnel } from '@phosphor-icons/react';
import type { MatchedVacancyFacets } from '../../../shared/matchedVacancyFacets';
import { CANDIDATE_REGION_CATALOGUE } from '../workspace/candidateRegions';
import { pluralRu } from '../../../shared/pluralRu';
import { VacancyAddRoleRow } from './VacancyAddRoleRow';
import { LEVEL_HUMAN_NAMES } from './vacancyLevel';

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

function FacetGroups({ props }: { readonly props: VacanciesScreenFiltersProps }) {
  const facets = props.facets;
  if (!facets) return null;
  return (
    <>
      <FacetGroup
        title="География"
        field="regions"
        props={props}
        options={facets.regions.map(({ id, count }) => ({ id, label: regionLabel(id), count }))}
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
      {props.onAddCustomRole ? (
        <div className="field-group">
          <VacancyAddRoleRow
            roleCount={props.campaignRoles?.length ?? 0}
            onAddCustomRole={props.onAddCustomRole}
          />
        </div>
      ) : null}
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

export function VacanciesFilters(props: VacanciesScreenFiltersProps) {
  const [expanded, setExpanded] = useState(false);
  const activeCount = countActiveFilters(props.state);
  return (
    <>
      <div className="filters-bar">
        <button
          type="button"
          className="filters-toggle vacancies-mobile-filter-toggle"
          aria-expanded={expanded}
          aria-label="Фильтры и сохранённые запросы"
          onClick={() => setExpanded((value) => !value)}
        >
          <Funnel weight="bold" aria-hidden="true" />
          <span>Фильтры · {pluralRu(activeCount, ['активный', 'активных', 'активных'])}</span>
        </button>
        {activeCount > 0 ? (
          <button type="button" className="filters-reset" onClick={props.onReset}>
            Сбросить
          </button>
        ) : null}
        <SavedSearchesButton props={props} />
      </div>
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
        <FacetGroups props={props} />
      </div>
    </>
  );
}
