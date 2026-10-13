import { CaretRight } from '@phosphor-icons/react';
import {
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type Ref,
  type SetStateAction,
} from 'react';

import { VacancyAddRoleRow } from './VacancyAddRoleRow';
import { CareerRoutePremises } from '../cabinet/CareerRoutePremises';
import { CareerRoutePremisesEditor } from '../cabinet/CareerRoutePremisesEditor';
import { CANDIDATE_REGION_CATALOGUE } from '../workspace/candidateRegions';
import type { RoutePremisesDraft } from '../cabinet/routePremises';

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

function mobileVacancyFilterSummary(
  props: Pick<VacanciesScreenFiltersProps, 'state' | 'facets'>,
  group: VacancyFilterGroup,
): string {
  if (group === 'format') {
    const formats = (props.state.formats ?? []).map(
      (format) => MOBILE_FORMAT_LABELS[format] ?? format,
    );
    if (!formats.length) return props.state.remoteOnly ? 'Удалённо' : 'Любой';
    const [first, ...rest] = formats;
    return [first, ...rest.map((label) => label.toLocaleLowerCase('ru-RU'))].join(', ');
  }
  if (group === 'sources') {
    const selected = props.state.sources ?? [];
    return (
      selected
        .map(
          (sourceId) =>
            props.facets?.sources.find((source) => source.sourceId === sourceId)?.name ?? sourceId,
        )
        .join(', ') || 'Любые'
    );
  }
  return (
    summarizeVacancyFilterGroup(props.state, group) ?? (group === 'salary' ? 'Любая' : 'Любые')
  );
}

export function MobileVacancyFilterOverview({
  props,
  onSelectGroup,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly onSelectGroup: (group: VacancyFilterGroup) => void;
}) {
  return (
    <div className="vacancies-mobile-filter-overview" role="group" aria-label="Фильтры вакансий">
      {VACANCY_FILTER_GROUPS.map((group) => (
        <button
          key={group.id}
          type="button"
          className="vacancies-mobile-filter-row"
          data-filter-sheet-group={group.id}
          aria-controls="vacancies-filter-popover"
          onClick={() => onSelectGroup(group.id)}
        >
          <span className="vacancies-mobile-filter-row-copy">
            <span className="vacancies-mobile-filter-row-label">{group.label}</span>
            <span className="vacancies-mobile-filter-row-value">
              {mobileVacancyFilterSummary(props, group.id)}
            </span>
          </span>
          <CaretRight weight="bold" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

export function VacancyFilterActions({
  mobile,
  mobileOverview,
  changed,
  onReset,
  onApply,
}: {
  readonly mobile: boolean;
  readonly mobileOverview: boolean;
  readonly changed: boolean;
  readonly onReset: () => void;
  readonly onApply: () => void;
}) {
  return (
    <div
      className={`vacancies-filter-actions${mobile ? ' is-mobile' : ''}${
        mobileOverview ? ' is-mobile-overview' : ''
      }`}
    >
      <button type="button" className="filters-reset vacancies-sheet-reset" onClick={onReset}>
        {mobileOverview ? 'Сбросить' : 'Сбросить всё'}
      </button>
      <button
        type="button"
        className="btn btn-primary vacancies-filter-apply"
        disabled={!mobileOverview && !changed}
        onClick={onApply}
      >
        {mobileOverview ? 'Показать результаты' : 'Применить'}
      </button>
    </div>
  );
}

export function RoleFilterSection({
  props,
  roleInputRef,
}: {
  readonly props: VacanciesScreenFiltersProps;
  readonly roleInputRef?: Ref<HTMLInputElement>;
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

export function PremisesFilterSection({
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
