import type { ReactNode } from 'react';
import { Button, Icon, InfoTip, Link, StatusLine } from '../kit';
import type { B640Node } from '../routes';
import { useShell } from '../shell/ShellContext';
import type { RolesData } from './careerApi';
import { pageAttrs } from './careerPaths';
import { OwnRole } from './OwnRole';
import { PICK_ERROR } from './RolePickDialog';
import { skillCheckPath } from './skillCheckModel';
import { roleKey, searchButtonLabel, useRolePick, type RolePick } from './useRolePick';
import { compareCheckTag, type RoleRow } from './rolesModel';

const COLUMNS = 3;
const TIP =
  'Вилка и число вакансий — по вакансиям на hh.ru и сайтах компаний за 30 дней; вилка — по вакансиям с указанной зарплатой.';

function market(row: RoleRow): string {
  const count = row.vacancies === null ? 'вакансий не найдено' : `${row.vacancies} вакансий`;
  return row.wage ? `${row.wage} · ${count}` : count;
}

function CheckTag({ row }: { readonly row: RoleRow }) {
  const tag = compareCheckTag(row);
  return <span className={tag.ok ? 'tag ok' : 'tag miss'}>{tag.text}</span>;
}

interface PickProps {
  readonly rows: readonly RoleRow[];
  readonly picked: ReadonlySet<string>;
  readonly onToggle: (title: string) => void;
}

function DeskTable({ rows, picked, onToggle }: PickProps) {
  const line = (label: string, cell: (row: RoleRow) => ReactNode) => (
    <tr>
      <th scope="row">{label}</th>
      {rows.map((row) => (
        <td data-col={row.title} key={row.id}>
          {cell(row)}
        </td>
      ))}
    </tr>
  );
  return (
    <table className="cmp only-desk-t">
      <thead>
        <tr>
          <th scope="col">
            <span className="vh">Показатель</span>
          </th>
          {rows.map((row) => (
            <th scope="col" key={row.id}>
              <label className="r2-pick">
                <input
                  type="checkbox"
                  checked={picked.has(roleKey(row.title))}
                  onChange={() => onToggle(row.title)}
                />
                <span className="r2-pick-t">{row.title}</span>
              </label>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {line('Рынок', (row) => (
          <>
            {row.wage ?? 'нет данных о зарплатах'}
            <span className="sub">
              {row.vacancies === null ? 'вакансий не найдено' : `${row.vacancies} вакансий`}
            </span>
          </>
        ))}
        {line('Подтверждает опыт', (row) => row.confirms ?? '—')}
        {line('Чего не хватает', (row) => row.lacks ?? '—')}
        {line('Проверка навыков', (row) => (
          <CheckTag row={row} />
        ))}
      </tbody>
    </table>
  );
}

function MobileList({ rows, picked, onToggle }: PickProps) {
  return (
    <ul className="rr-list only-mob" aria-label="Роли">
      {rows.map((row) => (
        <li className="rr-item" key={row.id}>
          <label className="rr-pick">
            <input
              type="checkbox"
              checked={picked.has(roleKey(row.title))}
              onChange={() => onToggle(row.title)}
            />
            <span className="vh">Выбрать роль: {row.title}</span>
          </label>
          <details className="rr-row">
            <summary>
              <span className="rr-name">{row.title}</span>
              <CheckTag row={row} />
              <span className="rr-meta num">{market(row)}</span>
              <Icon name="down" />
            </summary>
            <dl className="kv">
              <dt>Подтверждает опыт</dt>
              <dd>{row.confirms ?? '—'}</dd>
              <dt>Чего не хватает</dt>
              <dd>{row.lacks ?? '—'}</dd>
              <dt>Проверка навыков</dt>
              <dd>
                <CheckTag row={row} />
              </dd>
            </dl>
          </details>
        </li>
      ))}
    </ul>
  );
}

function initialPick(rows: readonly RoleRow[]): readonly string[] {
  const search = rows.filter((row) => row.origin === 'search').map((row) => row.title);
  const first = rows[0];
  return search.length > 0 ? search : first ? [first.title] : [];
}

function SearchActions({
  pick,
  columns,
}: {
  readonly pick: RolePick;
  readonly columns: readonly RoleRow[];
}) {
  const busy = pick.state === 'busy';
  const first = columns.find((row) => row.title === pick.selected[0]);
  const checkLabel = first?.check ? 'Проверить вторую роль' : 'Проверить навыки';
  const checkRole = first?.check ? pick.selected[1] : pick.selected[0];
  return (
    <>
      {pick.state === 'error' ? <StatusLine state="err" text={PICK_ERROR} /> : null}
      <div className="actions r2-actions">
        <button
          className="btn is-primary r2-main"
          type="button"
          disabled={pick.selected.length === 0 || busy}
          aria-busy={busy || undefined}
          onClick={() => void pick.search()}
        >
          <Icon name={busy ? 'hourglass' : 'check'} />
          {searchButtonLabel(pick.selected)}
        </button>
        <Link className="btn" to={skillCheckPath(checkRole)}>
          {checkLabel}
        </Link>
      </div>
    </>
  );
}

function ForkBlock() {
  const { openConsultant } = useShell();
  return (
    <div className="col">
      <section className="mod" aria-labelledby="fork-title">
        <h3 className="mod-title" id="fork-title">
          Не можете выбрать
        </h3>
        <div className="actions">
          <Button icon="chat" onClick={() => openConsultant()}>
            Поговорить
          </Button>
        </div>
      </section>
    </div>
  );
}

/** S10 «Ищу, кем работать»: три ближайшие роли рядом, отметить и искать. */
export function CompareView({
  node,
  state,
  data,
  reload,
}: {
  readonly node: B640Node;
  readonly state?: string;
  readonly data: RolesData;
  readonly reload: () => void;
}) {
  const columns = data.rows.slice(0, COLUMNS);
  const pick = useRolePick(columns, initialPick(columns), data.campaign);
  const [top] = columns;
  return (
    <div className="page two" {...pageAttrs(node, state)}>
      <section className="lead col-wide" aria-labelledby="cmp-title">
        <div className="lead-head">
          <h2 className="lead-title is-long" id="cmp-title">
            {top ? `Ближе всего — ${top.title}` : 'Ролей пока нет'}
          </h2>
          <InfoTip label="Как посчитано" text={TIP} />
        </div>
        {columns.length > 0 ? (
          <>
            <DeskTable rows={columns} picked={pick.picked} onToggle={pick.toggle} />
            <MobileList rows={columns} picked={pick.picked} onToggle={pick.toggle} />
          </>
        ) : null}
        <SearchActions pick={pick} columns={columns} />
      </section>
      <ForkBlock />
      <div className="col">
        <OwnRole onAdded={reload} />
      </div>
    </div>
  );
}
