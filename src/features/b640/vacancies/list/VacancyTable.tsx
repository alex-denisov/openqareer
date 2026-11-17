import type { ReactNode } from 'react';
import type { ApplicationView } from '../../../applications/applicationsApi';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { companyLookupKey } from '../../../vacancies/vacancyScreenCollections';
import { Icon, InfoTip } from '../../kit';
import { DetailRow } from './DetailRow';
import { SORT_COLUMNS, type SortKey, type SortState } from './sortModel';
import { VacancyRow, type RowEnv, type RowPick } from './VacancyRow';
import type { MenuView, RowMenuActions } from './RowMenu';

export interface TableMenu {
  readonly id: string;
  readonly view: MenuView;
}

export interface VacancyTableProps {
  readonly items: readonly MatchedVacancyItem[];
  readonly env: RowEnv;
  readonly sort: SortState;
  readonly onSort: (key: SortKey) => void;
  readonly byCluster: ReadonlyMap<string, ApplicationView>;
  readonly wantedKeys: ReadonlySet<string>;
  readonly openId: string | null;
  readonly menu: TableMenu | null;
  readonly moneyTip: string | null;
  readonly actionsFor: (item: MatchedVacancyItem) => RowMenuActions;
  /** Режим «Помочь выбрать»: флажок и причина строки, `undefined` — строка обычная. */
  readonly pickFor?: (item: MatchedVacancyItem) => RowPick | undefined;
  readonly onToggleOpen: (id: string) => void;
  readonly onToggleSaved: (item: MatchedVacancyItem) => void;
  readonly onMenu: (id: string, view: MenuView) => void;
  readonly onCloseMenu: () => void;
  /** Блок скрытых вакансий: отдельный `tbody` над обычными строками. */
  readonly hidden?: ReactNode;
}

function SortHead({ column, sort, onSort, tip }: { column: (typeof SORT_COLUMNS)[number]; sort: SortState; onSort: (key: SortKey) => void; tip: string | null }) {
  const on = sort.key === column.key;
  const aria = on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  const hint = on ? (sort.dir === 'desc' ? 'по убыванию' : 'по возрастанию') : 'сортировать';
  const arrow = on ? `vt-arr${sort.dir === 'asc' ? ' is-asc' : ''}` : 'vt-arr is-idle';
  return (
    <th scope="col" className={`vt-th vt-${column.key}`} aria-sort={aria}>
      <div className="vt-thin">
        <button className={`vt-sort${on ? ' is-on' : ''}`} type="button" aria-label={`${column.label}, ${hint}`} onClick={() => onSort(column.key)}>
          {column.label}
          <Icon name={on ? 'down' : 'swap'} className={arrow} />
        </button>
        {column.key === 'money' && tip ? <InfoTip label="Как пересчитаны деньги" text={tip} /> : null}
      </div>
    </th>
  );
}

/** Таблица подборки; на 390 стили макета сами перестраивают её в карточки. */
export function VacancyTable(props: VacancyTableProps) {
  const { items, env, openId, menu } = props;
  return (
    <div className="vt-scroll">
      <table className="vt">
        <caption className="vh">Вакансии: таблица с сортировкой по столбцам</caption>
        <thead>
          <tr>
            {SORT_COLUMNS.map((column) => (
              <SortHead key={column.key} column={column} sort={props.sort} onSort={props.onSort} tip={props.moneyTip} />
            ))}
            <th scope="col" className="vt-th vt-acts-h">
              <span className="vh">Действия</span>
            </th>
          </tr>
        </thead>
        {props.hidden}
        <tbody>
          {items.flatMap((item) => {
            const id = item.cluster.id;
            const open = openId === id;
            const row = (
              <VacancyRow
                key={id}
                item={item}
                env={env}
                application={props.byCluster.get(id)}
                wanted={props.wantedKeys.has(companyLookupKey(item.cluster.canonicalCompany ?? ''))}
                open={open}
                menuView={menu?.id === id ? menu.view : null}
                menuActions={props.actionsFor(item)}
                pick={props.pickFor?.(item)}
                onToggleOpen={() => props.onToggleOpen(id)}
                onToggleSaved={() => props.onToggleSaved(item)}
                onMenu={(view) => props.onMenu(id, view)}
                onCloseMenu={props.onCloseMenu}
              />
            );
            return open ? [row, <DetailRow key={`${id}-detail`} item={item} env={env} />] : [row];
          })}
        </tbody>
      </table>
    </div>
  );
}
