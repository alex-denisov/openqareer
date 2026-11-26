// Общая таблица «Подборки» и «Сохранённых»: стили узкой области грузятся вместе с ней.
import './list.css';
import { useEffect, type ReactNode } from 'react';
import type { CurrencyRates } from '../../../../../shared/currencyRates';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { rememberClusters } from '../../shell/vacancyNames';
import type { VacancyLinks } from '../vacancyLinks';
import { ratesTipText } from './ratesNote';
import type { SortKey, SortState } from './sortModel';
import type { RowInteractions } from './useRowInteractions';
import { VacancyTable } from './VacancyTable';
import type { RowEnv, RowPick } from './VacancyRow';

export interface TableBlockProps {
  readonly items: readonly MatchedVacancyItem[];
  readonly env: RowEnv;
  readonly sort: SortState;
  readonly onSort: (key: SortKey) => void;
  readonly links: VacancyLinks;
  readonly rows: RowInteractions;
  readonly rates?: CurrencyRates;
  readonly hidden?: ReactNode;
  readonly own?: ReactNode;
  readonly pickFor?: (item: MatchedVacancyItem) => RowPick | undefined;
}

/** Таблица подборки с общим состоянием строк: раскрытие, окно действий, ☆. */
export function TableBlock({ items, env, sort, onSort, links, rows, rates, hidden, own, pickFor }: TableBlockProps) {
  // Отклик, открытый из строки, называет вакансию с первого кадра.
  useEffect(() => rememberClusters(items), [items]);
  return (
    <VacancyTable
      items={items}
      env={env}
      sort={sort}
      onSort={onSort}
      byCluster={links.byCluster}
      wantedKeys={rows.wantedKeys}
      openId={rows.openId}
      menu={rows.menu}
      moneyTip={ratesTipText(rates)}
      actionsFor={rows.actionsFor}
      pickFor={pickFor}
      onToggleOpen={rows.toggleOpen}
      onToggleSaved={rows.toggleSaved}
      onMenu={rows.openMenu}
      onCloseMenu={rows.closeMenu}
      hidden={hidden}
      own={own}
    />
  );
}
