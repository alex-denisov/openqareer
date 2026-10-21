import type { VacanciesScreenState } from './VacanciesScreenFilters';
import { CaretDown, Funnel } from '@phosphor-icons/react';
import { CANDIDATE_REGION_CATALOGUE } from '../workspace/candidateRegions';

export type VacancyFilterGroup = 'roles' | 'locations' | 'salary' | 'format' | 'sources';

export interface VacancyFilterGroupOption {
  readonly id: VacancyFilterGroup;
  readonly label: string;
  readonly active: boolean;
  readonly summary?: string;
}

export const VACANCY_FILTER_GROUPS: readonly {
  readonly id: VacancyFilterGroup;
  readonly label: string;
}[] = [
  { id: 'roles', label: 'Роли' },
  { id: 'locations', label: 'Локации' },
  { id: 'salary', label: 'Зарплата' },
  { id: 'format', label: 'Формат' },
  { id: 'sources', label: 'Источники' },
];

export function filterGroupMatches(
  activeGroup: VacancyFilterGroup | undefined,
  group: VacancyFilterGroup,
): boolean {
  return activeGroup === undefined || activeGroup === group;
}

export function filterGroupIsActive(
  state: VacanciesScreenState,
  group: VacancyFilterGroup,
): boolean {
  if (group === 'roles') return Boolean(state.roles.length || state.levels?.length);
  if (group === 'locations')
    return Boolean(
      state.regions.length ||
      state.selectedCity ||
      state.selectedLocations?.length ||
      state.locationSearch?.trim(),
    );
  if (group === 'salary')
    return state.salaryMinimum !== undefined || state.salaryMaximum !== undefined;
  if (group === 'format') return Boolean(state.remoteOnly || state.formats?.length);
  return Boolean(state.sources?.length);
}

const LEVEL_SUMMARY_LABELS: Readonly<Record<string, string>> = {
  ic: 'Специалист',
  lead: 'Лид',
  head: 'Head',
  vp: 'VP',
  'c-level': 'C-level',
};

const CURRENCY_MARKS: Readonly<Record<string, string>> = {
  RUR: '₽',
  RUB: '₽',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

/** «от 450 тыс. ₽»: the chip shows the sign, not the hh.ru code. */
function currencyMark(currency: string): string {
  return CURRENCY_MARKS[currency.toUpperCase()] ?? currency;
}

function compactSalary(amount: number): string {
  if (amount >= 1_000) {
    const thousands = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(
      amount / 1_000,
    );
    return `${thousands} тыс.`;
  }
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(amount);
}

function summarizeLocations(state: VacanciesScreenState): string | undefined {
  const selected = state.selectedLocations ?? [];
  if (selected.length) {
    const first = selected[0]!;
    return selected.length > 1 ? `${first} +${selected.length - 1}` : first;
  }
  if (state.selectedCity) return state.selectedCity;
  if (state.regions.length)
    return state.regions
      .map((id) => CANDIDATE_REGION_CATALOGUE.find((region) => region.id === id)?.label ?? id)
      .slice(0, 2)
      .join(', ');
  const search = state.locationSearch?.trim();
  return search || undefined;
}

export function summarizeVacancyFilterGroup(
  state: VacanciesScreenState,
  group: VacancyFilterGroup,
): string | undefined {
  if (group === 'roles') {
    const roles = state.roles.length
      ? state.roles
      : (state.levels ?? []).map((level) => LEVEL_SUMMARY_LABELS[level] ?? level);
    return roles.length ? roles.slice(0, 2).join(', ') : undefined;
  }
  if (group === 'locations') return summarizeLocations(state);
  if (group === 'salary') {
    const currency = state.salaryCurrency ? ` ${currencyMark(state.salaryCurrency)}` : '';
    if (state.salaryMinimum !== undefined && state.salaryMaximum !== undefined)
      return `${compactSalary(state.salaryMinimum)}–${compactSalary(state.salaryMaximum)}${currency}`;
    if (state.salaryMinimum !== undefined)
      return `от ${compactSalary(state.salaryMinimum)}${currency}`;
    if (state.salaryMaximum !== undefined)
      return `до ${compactSalary(state.salaryMaximum)}${currency}`;
    return undefined;
  }
  if (group === 'format') {
    if (state.formats?.length) return String(state.formats.length);
    return state.remoteOnly ? 'Удалённо' : undefined;
  }
  return state.sources?.length ? String(state.sources.length) : undefined;
}

export interface VacanciesFilterToolbarProps {
  readonly groups: readonly VacancyFilterGroupOption[];
  readonly expanded: boolean;
  readonly activeGroup: VacancyFilterGroup | null;
  readonly activeCount: number;
  readonly onToggle: () => void;
  readonly onSelectGroup: (group: VacancyFilterGroup) => void;
}

export function VacanciesFilterToolbar({
  groups,
  expanded,
  activeGroup,
  activeCount,
  onToggle,
  onSelectGroup,
}: VacanciesFilterToolbarProps) {
  return (
    <div className="filters-bar vacancies-filter-toolbar">
      <VacancyFilterGroupButtons
        groups={groups}
        activeGroup={activeGroup}
        onSelectGroup={onSelectGroup}
      />
      <MobileVacancyFilterChips groups={groups} onSelectGroup={onSelectGroup} />
      <button
        type="button"
        className="filters-toggle vacancies-mobile-filter-toggle"
        aria-expanded={expanded}
        aria-label="Фильтры"
        onClick={onToggle}
      >
        <Funnel weight="bold" aria-hidden="true" />
        <span>Фильтры {activeCount}</span>
      </button>
    </div>
  );
}

export function VacanciesFilterToolbarFromState({
  state,
  expanded,
  activeGroup,
  onToggle,
  onSelectGroup,
}: {
  readonly state: VacanciesScreenState;
  readonly expanded: boolean;
  readonly activeGroup: VacancyFilterGroup | null;
  readonly onToggle: () => void;
  readonly onSelectGroup: (group: VacancyFilterGroup) => void;
}) {
  const groups = VACANCY_FILTER_GROUPS.map((group) => ({
    ...group,
    active: filterGroupIsActive(state, group.id),
    summary: summarizeVacancyFilterGroup(state, group.id),
  }));
  return (
    <VacanciesFilterToolbar
      groups={groups}
      expanded={expanded}
      activeGroup={activeGroup}
      activeCount={groups.filter((group) => group.active).length}
      onToggle={onToggle}
      onSelectGroup={onSelectGroup}
    />
  );
}

function VacancyFilterGroupButtons({
  groups,
  activeGroup,
  onSelectGroup,
}: Pick<VacanciesFilterToolbarProps, 'groups' | 'activeGroup' | 'onSelectGroup'>) {
  return (
    <div className="vacancies-filter-group-buttons" role="group" aria-label="Группы фильтров">
      {groups.map((group) => (
        <button
          type="button"
          key={group.id}
          className={`vacancies-filter-group-button${group.active ? ' is-active' : ''}`}
          aria-expanded={activeGroup === group.id}
          aria-label={group.summary ? `${group.label}: ${group.summary}` : group.label}
          data-filter-group={group.id}
          aria-controls="vacancies-filter-popover"
          onClick={() => onSelectGroup(group.id)}
        >
          <span className="vacancies-filter-group-text">
            {group.id === 'salary' && group.summary ? null : (
              <span className="vacancies-filter-group-label">{group.label}</span>
            )}
            {group.summary ? (
              <span className="vacancies-filter-group-value">{group.summary}</span>
            ) : null}
          </span>
          <CaretDown size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function MobileVacancyFilterChips({
  groups,
  onSelectGroup,
}: Pick<VacanciesFilterToolbarProps, 'groups' | 'onSelectGroup'>) {
  return (
    <div className="vacancies-mobile-filter-chips" role="group" aria-label="Выбранные фильтры">
      {groups
        .filter((group) => group.summary)
        .map((group) => (
          <button
            type="button"
            key={group.id}
            className="vacancies-mobile-filter-chip"
            aria-label={`Изменить фильтр ${group.label}: ${group.summary}`}
            onClick={() => onSelectGroup(group.id)}
          >
            {group.summary}
          </button>
        ))}
    </div>
  );
}
