import React from 'react';
import { Check } from '@phosphor-icons/react';
import { COMPARE_ROWS, PLAN_CARDS, type CompareRow } from './tariffsPageContent';

/** Rows shown while folded: the first group, up to the next group heading. */
const FOLDED_ROWS = 5;
const FOLD_LABEL = 'Все возможности тарифов';
const PRO_COLUMN = PLAN_CARDS.findIndex((card) => card.recommended) + 1;

function cellClass(column: number, tab: number): string | undefined {
  const names = [column === PRO_COLUMN ? 'is-hl' : '', column === tab ? 'is-on' : ''].filter(
    Boolean,
  );
  return names.length > 0 ? names.join(' ') : undefined;
}

function Row({ row, tab }: Readonly<{ row: CompareRow; tab: number }>) {
  if ('group' in row) {
    return (
      <tr className="is-grp">
        <td colSpan={6}>{row.group}</td>
      </tr>
    );
  }
  return (
    <tr>
      <td>{row.label}</td>
      {Array.from(row.marks).map((mark, index) => {
        const included = mark === 'y';
        return (
          <td key={index} className={cellClass(index + 1, tab)}>
            {included ? (
              <Check size={16} className="pg-icon pg-yes" aria-label="Входит" />
            ) : (
              <span className="pg-no" aria-label="Не входит">
                —
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function CompareTable({ rows, tab }: Readonly<{ rows: readonly CompareRow[]; tab: number }>) {
  return (
    <div className="pg-card pg-cmp-wrap">
      <table className="pg-cmp" id="cmp">
        <thead>
          <tr>
            <th>Что делает openqareer</th>
            {PLAN_CARDS.map((card, index) => (
              <th key={card.id} className={cellClass(index + 1, tab)}>
                {card.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={'group' in row ? row.group : row.label} row={row} tab={tab} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TariffComparison() {
  const [expanded, setExpanded] = React.useState(false);
  const [tab, setTab] = React.useState(PRO_COLUMN);
  const rows = expanded ? COMPARE_ROWS : COMPARE_ROWS.slice(0, FOLDED_ROWS);
  return (
    <section className="pg-sec">
      <div className="ps-wrap">
        <div className="pg-sh is-one">
          <div>
            <span className="pg-label">Сравнение</span>
            <h2>Что входит в каждый тариф</h2>
          </div>
        </div>
        <div className="pg-tabs" role="group" aria-label="Тариф для сравнения">
          {PLAN_CARDS.map((card, index) => (
            <button
              key={card.id}
              type="button"
              aria-pressed={index + 1 === tab}
              onClick={() => setTab(index + 1)}
            >
              {card.name}
            </button>
          ))}
        </div>
        <CompareTable rows={rows} tab={tab} />
        <button
          type="button"
          className="pg-btn pg-fold-more"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Свернуть' : FOLD_LABEL}
        </button>
        <p className="pg-small pg-doubt">
          Не уверены, что нужно платить?{' '}
          <a className="pg-link" href="/signup?from=tariffs-doubt">
            Начните с Free
          </a>
          : резюме, подходящие должности и вакансии со всего рынка без срока.
        </p>
      </div>
    </section>
  );
}
