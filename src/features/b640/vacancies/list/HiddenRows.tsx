import { companyLookupKey } from '../../../vacancies/vacancyScreenCollections';
import { vacancyFitMark } from '../../../vacancies/vacancyFitModel';
import { Icon, InfoTip } from '../../kit';
import type { HiddenRow } from '../b640Api';
import { rowDate, rowFormat, rowGeo } from '../format';
import type { HiddenVacancies } from './useHiddenVacancies';
import { DetailRow } from './DetailRow';
import { HiddenMenu } from './HiddenMenu';
import { hiddenNote } from './hiddenModel';
import { MoreFoot } from './ListParts';
import { CompanyCell, FitCell, MoneyCell, type RowEnv } from './VacancyRow';

export interface HiddenRowsProps {
  readonly hidden: HiddenVacancies;
  readonly env: RowEnv;
  readonly openId: string | null;
  readonly menuId: string | null;
  readonly onToggleOpen: (id: string) => void;
  readonly onMenu: (id: string | null) => void;
  readonly onUnhide: (id: string) => Promise<void>;
}

const COLUMNS = 8;

function StateRow({ children }: { children: React.ReactNode }) {
  return (
    <tr>
      <td className="vt-c" colSpan={COLUMNS}>
        {children}
      </td>
    </tr>
  );
}

function HiddenRowView({ item, env, open, menuOpen, props }: { item: HiddenRow; env: RowEnv; open: boolean; menuOpen: boolean; props: HiddenRowsProps }) {
  const { cluster } = item;
  const id = cluster.id;
  const geo = rowGeo(item);
  const name = `${cluster.canonicalTitle}, ${cluster.canonicalCompany ?? ''}`;
  const mark = vacancyFitMark(item.explanation.fitView);
  return (
    <>
      <tr className={`vt-row is-hid${open ? ' is-open' : ''}${mark.kind === 'pending' ? ' is-counting' : ''}`}>
        <td className="vt-c vt-role">
          <div className="vt-rl">
            <button className="vt-toggle" type="button" aria-expanded={open} aria-controls={open ? `vacancy-details-${id}` : undefined} title={cluster.canonicalTitle} onClick={() => props.onToggleOpen(id)}>
              <span>{cluster.canonicalTitle}</span>
              <Icon name="down" className="vt-chev" />
            </button>
            <span className="tag va-tag va-hid">скрыто</span>
            <InfoTip label={`Почему скрыто: ${name}`} text={hiddenNote(item.hidden)} />
          </div>
        </td>
        <td className="vt-c vt-company" title={cluster.canonicalCompany}>
          <CompanyCell item={item} />
        </td>
        <td className="vt-c vt-money">
          <MoneyCell item={item} env={env} />
        </td>
        <td className="vt-c vt-fitc">
          <FitCell item={item} env={env} />
        </td>
        <td className="vt-c vt-geo" title={geo}>
          {geo}
        </td>
        <td className="vt-c vt-format">{rowFormat(item)}</td>
        <td className="vt-c vt-date num">{rowDate(item)}</td>
        <td className="vt-c vt-acts">
          <div className={`va${menuOpen ? ' has-m' : ''}`} role="group" aria-label={`Действия: ${name}`}>
            <button className="va-b va-more" type="button" title="Ещё действия" aria-label="Ещё действия" aria-expanded={menuOpen} aria-controls={menuOpen ? `va-m-${id}` : undefined} onClick={() => props.onMenu(menuOpen ? null : id)}>
              <Icon name="more" />
            </button>
            {menuOpen ? <HiddenMenu item={item} onUnhide={() => props.onUnhide(id)} onClose={() => props.onMenu(null)} /> : null}
          </div>
        </td>
      </tr>
      {open ? <DetailRow item={item} env={env} /> : null}
    </>
  );
}

function Foot({ hidden }: { hidden: HiddenVacancies }) {
  if (hidden.status === 'loading') {
    return (
      <StateRow>
        <p className="ls-state" role="status">
          Загружаем скрытые…
        </p>
      </StateRow>
    );
  }
  if (hidden.status === 'failed') {
    return (
      <StateRow>
        <div className="vl-err" role="alert">
          <Icon name="warn" />
          <span>Скрытые вакансии не загрузились</span>
          <button className="row-act" type="button" onClick={hidden.retry}>
            <Icon name="refresh" />
            Повторить
          </button>
        </div>
      </StateRow>
    );
  }
  if (hidden.rows.length === 0) {
    return (
      <StateRow>
        <p className="ls-state" role="status">
          Скрытых вакансий нет
        </p>
      </StateRow>
    );
  }
  if (hidden.left === 0) return null;
  return (
    <StateRow>
      <MoreFoot total={hidden.left} shown={0} onMore={hidden.loadMore} />
    </StateRow>
  );
}

/** Блок скрытых вакансий над обычными строками: `tbody.vt-hid` по макету s07. */
export function HiddenRows(props: HiddenRowsProps) {
  const { hidden, env } = props;
  return (
    <tbody className="vt-hid" aria-label="Скрытые вакансии">
      {hidden.rows.map((item) => (
        <HiddenRowView key={item.cluster.id} item={item} env={env} open={props.openId === item.cluster.id} menuOpen={props.menuId === item.cluster.id} props={props} />
      ))}
      <Foot hidden={hidden} />
    </tbody>
  );
}
