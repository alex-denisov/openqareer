import type { VacanciesScreenState } from './VacanciesScreenFilters';
import { CaretDown, SlidersHorizontal } from '@phosphor-icons/react';
import { CANDIDATE_REGION_CATALOGUE } from '../workspace/candidateRegions';
import { LOCATION_PATH_SEPARATOR } from '../../../shared/locationTree';

export type VacancyFilterGroup = 'roles' | 'locations' | 'salary' | 'format' | 'sources';

export interface VacancyFilterGroupOption {
  readonly id: VacancyFilterGroup;
  readonly label: string;
  readonly active: boolean;
  readonly summary?: string;
  /** Кнопка показывает «Подпись · N» вместо значения (роли). */
  readonly count?: number;
  /** Полный перечень для чтения с экрана, когда на кнопке только число. */
  readonly fullSummary?: string;
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
      state.selectedCities?.length ||
      state.selectedLocations?.length ||
      state.locationRemote ||
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
  const selected = [
    ...(state.selectedLocations ?? []),
    ...(state.locationRemote ? ['Удалённо'] : []),
  ];
  if (selected.length) {
    const first = selected[0]!.split(LOCATION_PATH_SEPARATOR).at(-1)!;
    return selected.length > 1 ? `${first} +${selected.length - 1}` : first;
  }
  const cities = state.selectedCities ?? [];
  if (cities.length) return cities.length > 1 ? `${cities[0]} +${cities.length - 1}` : cities[0];
  if (state.selectedCity) return state.selectedCity;
  if (state.regions.length) {
    // Two names fit the button; the rest are counted, as roles do («+N»).
    const shown = state.regions
      .slice(0, 2)
      .map((id) => CANDIDATE_REGION_CATALOGUE.find((region) => region.id === id)?.label ?? id)
      .join(', ');
    const rest = state.regions.length - 2;
    return rest > 0 ? `${shown} +${rest}` : shown;
  }
  const search = state.locationSearch?.trim();
  return search || undefined;
}

/** Города и удалёнка из условий «Карьеры» — места дерева «Локаций» (CPO 26.10). */
export interface CareerLocations {
  readonly places: readonly string[];
  readonly remote: boolean;
}

/**
 * B446-g4: роли и регионы кампании уже фильтруют подборку, значит кнопки и чипы их
 * называют (макет 4: «Роли Head, Director»). Ручной выбор важнее кампании;
 * география «Карьеры» важнее регионов мастера (CPO 26.10).
 */
export function withCampaignDefaults(
  state: VacanciesScreenState,
  campaignRoles: readonly string[] = [],
  campaignRegions: readonly string[] = [],
  careerLocations?: CareerLocations,
): VacanciesScreenState {
  const locationsPicked = filterGroupIsActive(state, 'locations');
  const roles = state.roles.length || state.levels?.length ? state.roles : campaignRoles;
  if (locationsPicked) return { ...state, roles };
  if (careerLocations) {
    return {
      ...state,
      roles,
      regions: [],
      selectedLocations: careerLocations.places,
      locationRemote: careerLocations.remote,
    };
  }
  return { ...state, roles, regions: campaignRegions };
}

const LEVEL_PREFIX = /^(\S+)\s+(of\s+.+)$/iu;

/**
 * B446-g4: «Head of Engineering, Director of Engineering» → «Head, Director» (макет 4);
 * роли с разной функцией — первая и «+N».
 */
export function shortRoleSummary(roles: readonly string[]): string {
  if (roles.length === 1) return roles[0]!;
  const parts = roles.map((role) => LEVEL_PREFIX.exec(role.trim()));
  const sameFunction =
    parts.every(Boolean) &&
    new Set(parts.map((part) => part![2]!.toLocaleLowerCase('en'))).size === 1;
  if (sameFunction) return parts.map((part) => part![1]).join(', ');
  // Уже короткие подписи уровня («Head», «Director») остаются списком.
  if (roles.length <= 3 && roles.every((role) => !/\s/u.test(role.trim()))) return roles.join(', ');
  return `${roles[0]} +${roles.length - 1}`;
}

export function summarizeVacancyFilterGroup(
  state: VacanciesScreenState,
  group: VacancyFilterGroup,
): string | undefined {
  if (group === 'roles') {
    const roles = state.roles.length
      ? state.roles
      : (state.levels ?? []).map((level) => LEVEL_SUMMARY_LABELS[level] ?? level);
    return roles.length ? shortRoleSummary(roles) : undefined;
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
        <SlidersHorizontal size={18} aria-hidden="true" />
        <span>Фильтры</span> <span className="vacancies-mobile-filter-badge">{activeCount}</span>
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
  const roleCount = state.roles.length || (state.levels?.length ?? 0);
  const groups = VACANCY_FILTER_GROUPS.map((group) => ({
    ...group,
    active: filterGroupIsActive(state, group.id),
    summary: summarizeVacancyFilterGroup(state, group.id),
    // CPO 26.10, макет 4: на кнопке «Роли · N», названия — в выпадающем списке.
    ...(group.id === 'roles' && roleCount
      ? { count: roleCount, fullSummary: state.roles.join(', ') || undefined }
      : {}),
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

function groupAriaLabel(group: VacancyFilterGroupOption): string {
  const summary = group.fullSummary ?? group.summary;
  return summary ? `${group.label}: ${summary}` : group.label;
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
          aria-label={groupAriaLabel(group)}
          data-filter-group={group.id}
          aria-controls="vacancies-filter-popover"
          onClick={() => onSelectGroup(group.id)}
        >
          <span className="vacancies-filter-group-text">
            {group.id === 'salary' && group.summary ? null : (
              <span className="vacancies-filter-group-label">{group.label}</span>
            )}
            {group.count ? (
              <span className="vacancies-filter-group-value">{` · ${group.count}`}</span>
            ) : group.summary ? (
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
