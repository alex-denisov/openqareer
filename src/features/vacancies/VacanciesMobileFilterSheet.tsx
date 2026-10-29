import type { ReactNode } from 'react';
import {
  Briefcase,
  CaretLeft,
  CaretRight,
  Coins,
  GlobeHemisphereWest,
  House,
  MapPin,
} from '@phosphor-icons/react';

import { VACANCY_FILTER_GROUPS, type VacancyFilterGroup } from './VacanciesFilterToolbar';
import './vacancy-mobile-filter-sheet.css';

/**
 * Лист фильтров 390 по макету 4 (`?frame&sheet=filters`, B547 / возврат B446):
 * строки-ссылки групп с выбранными значениями, «Сбросить» в шапке и
 * «Показать N» внизу. Строка открывает push-экран своей группы с кнопкой назад.
 */

const GROUP_ICONS: Readonly<Record<VacancyFilterGroup, typeof Briefcase>> = {
  roles: Briefcase,
  locations: MapPin,
  salary: Coins,
  format: House,
  sources: GlobeHemisphereWest,
};

const numberFormat = new Intl.NumberFormat('ru-RU');

export function showResultsLabel(count: number | undefined): string {
  return count === undefined ? 'Показать результаты' : `Показать ${numberFormat.format(count)}`;
}

export interface MobileFilterSheetProps {
  readonly activeGroup: VacancyFilterGroup | null;
  readonly values: Readonly<Record<VacancyFilterGroup, string>>;
  readonly subtitle?: string;
  readonly resultCount?: number;
  readonly onSelectGroup: (group: VacancyFilterGroup) => void;
  readonly onBack: () => void;
  readonly onReset: () => void;
  readonly onShow: () => void;
  readonly children: ReactNode;
}

function OverviewRows({
  values,
  onSelectGroup,
}: Pick<MobileFilterSheetProps, 'values' | 'onSelectGroup'>) {
  return (
    <div className="vacancies-mobile-filter-overview" role="group" aria-label="Фильтры вакансий">
      {VACANCY_FILTER_GROUPS.map((group) => {
        const Icon = GROUP_ICONS[group.id];
        return (
          <button
            key={group.id}
            type="button"
            className="vacancies-mobile-filter-row"
            data-filter-sheet-group={group.id}
            aria-label={`${group.label}: ${values[group.id]}`}
            onClick={() => onSelectGroup(group.id)}
          >
            <span className="vacancies-mobile-filter-row-icon" aria-hidden="true">
              <Icon size={20} />
            </span>
            <span className="vacancies-mobile-filter-row-label">{group.label}</span>
            <span className="vacancies-mobile-filter-row-value">{values[group.id]}</span>
            <CaretRight size={16} weight="bold" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

function SheetHead({
  activeGroup,
  onBack,
  onReset,
}: Pick<MobileFilterSheetProps, 'activeGroup' | 'onBack' | 'onReset'>) {
  const title = VACANCY_FILTER_GROUPS.find(({ id }) => id === activeGroup)?.label ?? 'Фильтры';
  return (
    <div className="vacancies-mobile-sheet-head">
      {activeGroup ? (
        <button
          type="button"
          className="vacancies-mobile-sheet-back"
          aria-label="Назад к фильтрам"
          onClick={onBack}
        >
          <CaretLeft size={20} weight="bold" aria-hidden="true" />
        </button>
      ) : null}
      <h3>{title}</h3>
      {activeGroup ? null : (
        <button type="button" className="vacancies-mobile-sheet-reset" onClick={onReset}>
          Сбросить
        </button>
      )}
    </div>
  );
}

export function MobileFilterSheet(props: MobileFilterSheetProps) {
  return (
    <div className="vacancies-mobile-sheet" data-sheet-view={props.activeGroup ?? 'overview'}>
      <span className="vacancies-mobile-sheet-grab" aria-hidden="true" />
      <SheetHead activeGroup={props.activeGroup} onBack={props.onBack} onReset={props.onReset} />
      {props.activeGroup ? (
        <div className="vacancies-mobile-sheet-body">{props.children}</div>
      ) : (
        <>
          {props.subtitle ? (
            <p className="vacancies-mobile-sheet-subtitle">{props.subtitle}</p>
          ) : null}
          <OverviewRows values={props.values} onSelectGroup={props.onSelectGroup} />
        </>
      )}
      <button type="button" className="vacancies-mobile-sheet-cta" onClick={props.onShow}>
        {showResultsLabel(props.resultCount)}
      </button>
    </div>
  );
}
