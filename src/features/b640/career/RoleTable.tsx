import { useState } from 'react';
import { Icon, InfoTip, Link } from '../kit';
import { buildNodePath } from '../routes';
import { ORIGIN_LABEL, type RoleRow } from './rolesModel';

const SHOWN = 3;
const SOURCE =
  'Вилка — по вакансиям с указанной зарплатой на hh.ru и сайтах компаний за 30 дней; число вакансий с зарплатой — у каждой роли. Где источника нет, вилку не показываем.';

function Origin({ row }: { readonly row: RoleRow }) {
  return row.origin === 'search' ? (
    <span className="tag ok">{ORIGIN_LABEL.search}</span>
  ) : (
    <>{ORIGIN_LABEL[row.origin]}</>
  );
}

function Wage({ row }: { readonly row: RoleRow }) {
  return (
    <>
      {row.wage}
      <span className="c9-n">{row.wageNote}</span>
    </>
  );
}

function GoLink({ row }: { readonly row: RoleRow }) {
  return (
    <Link
      className="btn is-quiet c9-go"
      to={buildNodePath('s07')}
      aria-label={`Вакансии по роли «${row.title}»`}
    >
      <Icon name="search" />
      Вакансии по роли
    </Link>
  );
}

const count = (row: RoleRow): string => (row.vacancies === null ? '—' : String(row.vacancies));

function DeskTable({ rows }: { readonly rows: readonly RoleRow[] }) {
  return (
    <table className="c9-table only-desk-t">
      <thead>
        <tr>
          <th scope="col">Роль</th>
          <th scope="col">Вилка</th>
          <th scope="col" aria-sort="descending">
            <span className="c9-sort">
              Вакансий
              <Icon name="down" />
            </span>
            <small className="c9-basis">по подборке за 30 дней</small>
          </th>
          <th scope="col">Откуда роль</th>
          <th scope="col">
            <span className="vh">Дальше</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <th scope="row">{row.title}</th>
            <td className="num">
              <Wage row={row} />
            </td>
            <td className="num">{count(row)}</td>
            <td>
              <Origin row={row} />
            </td>
            <td className="c9-act">
              <GoLink row={row} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MobileList({ rows }: { readonly rows: readonly RoleRow[] }) {
  return (
    <ul className="c9-accs only-mob" aria-label="Роли по вашему профилю">
      {rows.map((row) => (
        <li className="c9-acc" key={row.id}>
          <details>
            <summary>
              <span className="c9-name">{row.title}</span>
              <span className="num c9-cnt">{count(row)}</span>
              <Icon name="down" className="c9-chev" />
            </summary>
            <dl className="kv">
              <dt>Вилка</dt>
              <dd className="num">
                <Wage row={row} />
              </dd>
              <dt>Откуда</dt>
              <dd>
                <Origin row={row} />
              </dd>
            </dl>
            <GoLink row={row} />
          </details>
        </li>
      ))}
    </ul>
  );
}

/** «Роли по вашему профилю»: три строки и «Показать все» (макет s09). */
export function RoleTable({ rows }: { readonly rows: readonly RoleRow[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <section className="mod c9-near" aria-labelledby="near-title">
      <h3 className="mod-title" id="near-title">
        Роли по вашему профилю · {rows.length}
        <InfoTip label="Как посчитано" text={SOURCE} />
      </h3>
      {rows.length === 0 ? (
        <p className="mod-text">Ролей пока нет — добавьте опыт в профиль</p>
      ) : (
        <>
          <DeskTable rows={shown} />
          <MobileList rows={shown} />
        </>
      )}
      {rows.length > SHOWN ? (
        <div className="c9-foot">
          <span className="c9-shown">
            Показаны {shown.length} из {rows.length}
          </span>
          {all ? null : (
            <button
              className="btn"
              type="button"
              aria-expanded="false"
              onClick={() => setAll(true)}
            >
              <Icon name="down" />
              Показать все {rows.length}
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
