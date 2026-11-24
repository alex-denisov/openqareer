import { Fragment, type ReactNode } from 'react';
import { Icon, Link } from '../kit';
import { buildNodePath } from '../routes';
import type { ListedResponse, SortKey, SortState } from './model/responseList';
import type { ResponseRow } from './model/responseRow';

interface Column {
  readonly key: SortKey;
  readonly label: string;
  readonly className: string;
}

const COLUMNS: readonly Column[] = [
  { key: 'role', label: 'Должность', className: 'ot-c-role' },
  { key: 'company', label: 'Компания', className: 'ot-c-co' },
  { key: 'stage', label: 'Стадия', className: 'ot-c-st' },
  { key: 'next', label: 'Что дальше', className: 'ot-c-nxt' },
  { key: 'sent', label: 'Отклик', className: 'ot-c-sent is-num' },
];

function ariaSort(sort: SortState, key: SortKey): 'ascending' | 'descending' | 'none' {
  if (sort.key !== key) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

function sortLabel(column: Column, sort: SortState): string {
  if (sort.key !== column.key) return `${column.label}, сортировать`;
  return `${column.label}, ${sort.direction === 'asc' ? 'по возрастанию' : 'по убыванию'}`;
}

interface HeadProps {
  readonly sort: SortState;
  readonly onSort: (key: SortKey) => void;
}

function TableHead({ sort, onSort }: HeadProps) {
  return (
    <thead>
      <tr>
        {COLUMNS.map((column) => {
          const active = sort.key === column.key;
          return (
            <th
              key={column.key}
              scope="col"
              className={`vt-th ot-th ${column.className}`}
              aria-sort={ariaSort(sort, column.key)}
            >
              <div className="vt-thin">
                <button
                  className={active ? 'vt-sort is-on' : 'vt-sort'}
                  type="button"
                  aria-label={sortLabel(column, sort)}
                  onClick={() => onSort(column.key)}
                >
                  {column.label}
                  {active ? (
                    <Icon name="down" className={`vt-arr is-${sort.direction}`} />
                  ) : (
                    <Icon name="swap" className="vt-arr is-idle" />
                  )}
                </button>
              </div>
            </th>
          );
        })}
        <th scope="col" className="vt-th ot-th ot-c-act">
          <span className="vh">Действие</span>
        </th>
      </tr>
    </thead>
  );
}

/** Адрес действия строки: письмо или условия оффера. */
export function actionPath(row: ResponseRow): string {
  if (row.action?.kind === 'offer') return buildNodePath('o06a', { offerId: row.id });
  if (row.action?.kind === 'debrief') return buildNodePath('o01c', { responseId: row.id });
  return buildNodePath('o02', { responseId: row.id });
}

function RowActionCell({ row, primary }: { readonly row: ResponseRow; readonly primary: boolean }) {
  if (!row.action) {
    return (
      <Link
        className="icon-btn"
        to={buildNodePath('o01c', { responseId: row.id })}
        aria-label={`Открыть отклик: ${row.company}`}
      >
        <Icon name="right" />
      </Link>
    );
  }
  return (
    <Link
      className={primary ? 'btn ev-act is-primary' : 'btn ev-act'}
      to={actionPath(row)}
      aria-label={row.action.label}
    >
      <Icon name={row.action.icon} />
      <span className="ev-lbl">
        <span className="ev-full">{row.action.label}</span>
        <span className="ev-short" aria-hidden="true">
          {row.action.short}
        </span>
      </span>
    </Link>
  );
}

interface RowProps {
  readonly row: ResponseRow;
  readonly open: boolean;
  readonly next: boolean;
  readonly detailId: string;
  readonly onToggle: (id: string) => void;
}

function TableRow({ row, open, next, detailId, onToggle }: RowProps) {
  const className = ['vt-row ot-row', open ? 'is-open' : '', next ? 'is-next' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <tr className={className} data-response-id={row.id}>
      <td className="vt-c ot-c ot-c-role">
        <button
          className="vt-toggle"
          type="button"
          aria-expanded={open}
          aria-controls={open ? detailId : undefined}
          onClick={() => onToggle(row.id)}
        >
          <span title={row.role}>{row.role}</span>
          <Icon name="down" className="vt-chev" />
        </button>
        <span className="ot-sub">
          {row.company} · <span className="num">{row.sent}</span>
        </span>
      </td>
      <td className="vt-c ot-c ot-c-co">{row.company}</td>
      <td className="vt-c ot-c ot-c-st">
        <span className={`tag ${row.tag.tone}`}>{row.tag.label}</span>
      </td>
      <td className="vt-c ot-c ot-c-nxt">
        {row.next}
        <small className="ot-ev num">{row.event}</small>
      </td>
      <td className="vt-c ot-c ot-c-sent is-num num">{row.sent}</td>
      <td className="vt-c ot-c ot-c-act">
        {open ? null : <RowActionCell row={row} primary={next} />}
      </td>
    </tr>
  );
}

export interface ResponsesTableProps {
  readonly items: readonly ListedResponse[];
  readonly sort: SortState;
  readonly onSort: (key: SortKey) => void;
  /** Раскрытый отклик и его содержимое. */
  readonly openId: string | null;
  readonly detail: ReactNode;
  /** Строка, с которой стоит начать: её кнопка главная. */
  readonly nextId: string | null;
  readonly onToggle: (id: string) => void;
}

/** Таблица откликов макета O1: на 390 строки складываются в карточки стилями макета. */
export function ResponsesTable(props: ResponsesTableProps) {
  const { items, sort, onSort, openId, detail, nextId, onToggle } = props;
  return (
    <div className="ot-scroll">
      <table className="vt ot">
        <caption className="vh">Отклики: таблица с сортировкой по столбцам</caption>
        <TableHead sort={sort} onSort={onSort} />
        <tbody>
          {items.map(({ row }) => {
            const open = row.id === openId;
            const detailId = `otklik-${row.id}`;
            return (
              <Fragment key={row.id}>
                <TableRow
                  row={row}
                  open={open}
                  next={row.id === nextId && !open}
                  detailId={detailId}
                  onToggle={onToggle}
                />
                {open ? (
                  <tr className="vt-detail-row is-next">
                    <td colSpan={6}>
                      <section
                        className="od od-one"
                        id={detailId}
                        aria-labelledby={`${detailId}-t`}
                      >
                        {detail}
                      </section>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
