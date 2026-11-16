import { Icon, Link, type IconName } from '../../kit';
import { buildNodePath } from '../../routes';
import type { FitRow, FitStatus } from './fitRows';

const ICONS: Readonly<Record<FitStatus, IconName>> = {
  matched: 'checkc',
  partial: 'circle',
  unknown: 'question',
  unmatched: 'minus',
};

const CLASSES: Readonly<Record<FitStatus, string>> = {
  matched: 'is-met',
  partial: 'is-part',
  unknown: 'is-unk',
  unmatched: 'is-no',
};

function Evidence({ row }: { readonly row: FitRow }) {
  if (!row.evidence) return null;
  if (row.status === 'matched') {
    return (
      <Link className="v4-fd-ev" to={buildNodePath('s01')}>
        {row.evidence}
      </Link>
    );
  }
  return <span className="v4-fd-ev">{row.evidence}</span>;
}

export interface RequirementListProps {
  readonly rows: readonly FitRow[];
}

/** Требования вакансии с цитатой из профиля; у частичных и неизвестных — «Проверить». */
export function RequirementList({ rows }: RequirementListProps) {
  return (
    <ul className="v4-fd-l">
      {rows.map((row) => (
        <li key={row.id} className={CLASSES[row.status]}>
          <Icon name={ICONS[row.status]} />
          <span className="v4-fd-r">{row.text}</span>
          <Evidence row={row} />
          {row.canCheck ? (
            <Link
              className="btn is-sm v4-fd-go"
              to={buildNodePath('c04')}
              aria-label={`Проверить: ${row.text}`}
            >
              Проверить
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
