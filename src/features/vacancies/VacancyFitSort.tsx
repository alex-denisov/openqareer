import { CaretDown, CaretUp, CaretUpDown } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { salaryMidpoint } from '../../../shared/marketSalaryEstimate';
import type { Dispatch, SetStateAction } from 'react';
import type { VacanciesScreenState } from './vacanciesScreenState';
import {
  compareFitDirected,
  compareMoney,
  DEFAULT_VACANCY_SORT,
  nextVacancySort,
  type VacancySort,
  type VacancySortKey,
} from '../../../shared/vacancySort';

/** Stated salary, else the market estimate; a fallback when the server did not order the list. */
function moneyOf(item: MatchedVacancyItem): number | undefined {
  const salary = item.cluster.salary;
  if (salary && (salary.from || salary.to)) return salaryMidpoint(salary);
  const estimate = item.explanation.marketSalary;
  return estimate?.low !== undefined && estimate.high !== undefined
    ? salaryMidpoint({ from: estimate.low, to: estimate.high })
    : undefined;
}

export function sortVacancyFitItems(
  items: readonly MatchedVacancyItem[],
  sort: VacancySort = DEFAULT_VACANCY_SORT,
): MatchedVacancyItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        (sort.by === 'money'
          ? compareMoney(moneyOf(a.item), moneyOf(b.item), sort.dir)
          : compareFitDirected(a.item.explanation.fitView, b.item.explanation.fitView, sort.dir)) ||
        a.index - b.index,
    )
    .map((row) => row.item);
}

/**
 * «Деньги» and «Совпадение» headers at 1440 (mockup 4-vakansii-procent-sort, 29.10): the active
 * one shows CaretDown/CaretUp in the accent colour, the other a dim CaretUpDown.
 */
export function VacancySortHeader({
  column,
  label,
  sort,
  onSort,
}: {
  readonly column: VacancySortKey;
  readonly label: string;
  readonly sort: VacancySort;
  readonly onSort: (column: VacancySortKey) => void;
}) {
  const active = sort.by === column;
  const Icon = !active ? CaretUpDown : sort.dir === 'desc' ? CaretDown : CaretUp;
  return (
    <span
      role="columnheader"
      aria-sort={active ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined}
    >
      <button
        type="button"
        className={`vacancies-sort-header${active ? ' is-active' : ''}`}
        onClick={() => onSort(column)}
      >
        {label}
        <Icon size={14} weight="bold" aria-hidden="true" />
      </button>
    </span>
  );
}

/** The header click wins, else the sort the server saved for the account (29.10). */
export function effectiveVacancySort(
  chosen: VacancySort | undefined,
  server: VacancySort | undefined,
): VacancySort {
  return chosen ?? server ?? DEFAULT_VACANCY_SORT;
}

export interface VacancySortProps {
  readonly sort: VacancySort;
  readonly onSortChange: (column: VacancySortKey) => void;
}

export function vacancySortProps(
  chosen: VacancySort | undefined,
  setState: Dispatch<SetStateAction<VacanciesScreenState>>,
  server: VacancySort | undefined,
): VacancySortProps {
  return {
    sort: effectiveVacancySort(chosen, server),
    onSortChange: (column) =>
      setState((previous) => ({
        ...previous,
        sort: nextVacancySort(effectiveVacancySort(previous.sort, server), column),
      })),
  };
}
