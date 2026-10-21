import { useEffect, type Dispatch, type ReactNode, type SetStateAction } from 'react';

import { CANDIDATE_REGION_CATALOGUE } from '../workspace/candidateRegions';

import {
  VACANCY_FILTER_GROUPS,
  summarizeVacancyFilterGroup,
  type VacancyFilterGroup,
} from './VacanciesFilterToolbar';
import type { VacanciesScreenFiltersProps } from './VacanciesScreenFilters';

export interface VacanciesFilterPopoverProps {
  readonly title: string;
  readonly activeGroup?: VacancyFilterGroup | null;
  readonly open: boolean;
  readonly mobileOpen: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function VacanciesFilterPopover({
  title,
  activeGroup,
  open,
  mobileOpen,
  onClose,
  children,
}: VacanciesFilterPopoverProps) {
  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          className="vacancies-mobile-sheet-scrim"
          aria-label="Закрыть фильтры"
          onClick={onClose}
        />
      ) : null}
      <div
        id="vacancies-filter-popover"
        className={`filters-panel vacancies-filters${open ? ' is-expanded' : ''}${mobileOpen ? ' is-mobile-open' : ''}`}
        aria-label="Фильтры"
        data-active-group={activeGroup ?? 'all'}
        hidden={!open}
      >
        <div className="filters-panel-head">
          <h3>{title}</h3>
          <button type="button" className="filters-reset" onClick={onClose}>
            Свернуть
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

export function isMobileFilterViewport(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches === true
  );
}

export function useMobileRoleFocus(
  focusRole: boolean | undefined,
  setActiveGroup: Dispatch<SetStateAction<VacancyFilterGroup | null>>,
  setExpanded: Dispatch<SetStateAction<boolean>>,
) {
  useEffect(() => {
    if (!focusRole || !isMobileFilterViewport()) return;
    setActiveGroup('roles');
    setExpanded(true);
  }, [focusRole, setActiveGroup, setExpanded]);
}

export function candidateRegionLabel(id: string): string {
  return CANDIDATE_REGION_CATALOGUE.find((entry) => entry.id === id)?.label ?? id;
}

const MOBILE_FORMAT_LABELS: Readonly<Record<string, string>> = {
  hybrid: 'Гибрид',
  remote: 'Удалённо',
  office: 'В офисе',
  unknown: 'Не указано',
};

function mobileFilterValue(
  state: VacanciesScreenFiltersProps['state'],
  group: VacancyFilterGroup,
  sourceCatalogCount: number,
): string {
  if (group === 'format') {
    const formats = (state.formats ?? []).map((format) => MOBILE_FORMAT_LABELS[format] ?? format);
    if (!formats.length) return state.remoteOnly ? 'Удалённо' : 'Любой';
    const [first, ...rest] = formats;
    return [first, ...rest.map((label) => label.toLocaleLowerCase('ru-RU'))].join(', ');
  }
  if (group === 'sources') {
    const selected = state.sources?.length ?? 0;
    if (!selected) return 'Любые';
    return sourceCatalogCount
      ? `${selected} из ${new Intl.NumberFormat('ru-RU').format(sourceCatalogCount)}`
      : String(selected);
  }
  return summarizeVacancyFilterGroup(state, group) ?? (group === 'salary' ? 'Любая' : 'Любые');
}

/** Значения строк листа фильтров 390 (B547). */
export function mobileFilterValues(
  state: VacanciesScreenFiltersProps['state'],
  sourceCatalogCount: number,
): Record<VacancyFilterGroup, string> {
  return Object.fromEntries(
    VACANCY_FILTER_GROUPS.map(({ id }) => [id, mobileFilterValue(state, id, sourceCatalogCount)]),
  ) as Record<VacancyFilterGroup, string>;
}

export function VacancyFilterActions({
  changed,
  onReset,
  onApply,
}: {
  readonly changed: boolean;
  readonly onReset: () => void;
  readonly onApply: () => void;
}) {
  return (
    <div className="vacancies-filter-actions">
      <button type="button" className="filters-reset vacancies-sheet-reset" onClick={onReset}>
        Сбросить всё
      </button>
      <button
        type="button"
        className="btn btn-primary vacancies-filter-apply"
        disabled={!changed}
        onClick={onApply}
      >
        Применить
      </button>
    </div>
  );
}
