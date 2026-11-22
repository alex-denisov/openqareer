import type { CurrencyRates } from '../../../../../shared/currencyRates';
import type { ApplicationView } from '../../../applications/applicationsApi';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { vacancyFitMark } from '../../../vacancies/vacancyFitModel';
import { Icon, Link } from '../../kit';
import { buildNodePath } from '../../routes';
import { fitTierWord, moneyView, rowDate, rowFormat, rowGeo, type MoneyCurrency } from '../format';
import { appliedOn, isSaved } from '../vacancyLinks';
import { NO_COMPANY, companyNodePath } from '../companyPath';
import { RowMenu, type MenuView, type RowMenuActions } from './RowMenu';

export interface RowEnv {
  readonly currency: MoneyCurrency;
  readonly rates?: CurrencyRates;
  /** У кампании нет ролей: процент не считается, ссылка «Выберите роль». */
  readonly noRole: boolean;
}

/** Строка в режиме «Помочь выбрать»: вердикт hide с причиной и флажком. */
export interface RowPick {
  readonly checked: boolean;
  readonly reason: string;
  readonly onToggle: () => void;
}

export interface VacancyRowProps {
  readonly item: MatchedVacancyItem;
  readonly env: RowEnv;
  readonly application?: ApplicationView;
  readonly wanted: boolean;
  readonly open: boolean;
  readonly menuView: MenuView | null;
  readonly menuActions: RowMenuActions;
  readonly onToggleOpen: () => void;
  readonly onToggleSaved: () => void;
  readonly onMenu: (view: MenuView) => void;
  readonly onCloseMenu: () => void;
  readonly pick?: RowPick;
}

export function FitCell({ item, env }: { item: MatchedVacancyItem; env: RowEnv }) {
  const mark = vacancyFitMark(item.explanation.fitView);
  if (mark.kind === 'number') {
    return (
      <span className={`fit vt-fit is-${mark.tier} num`}>
        {mark.percent}
        <small>%</small>
        <span className="vh"> совпадение, {fitTierWord(mark.tier)}</span>
      </span>
    );
  }
  if (mark.kind === 'pending') {
    return (
      <span className="vt-counting">
        <Icon name="hourglass" />
        считаем
      </span>
    );
  }
  if (env.noRole) {
    return (
      <Link className="row-act vt-fitlink" to={buildNodePath('s10')}>
        Выберите роль
      </Link>
    );
  }
  if (mark.caption === 'нет профиля') {
    return (
      <Link className="row-act vt-fitlink" to={buildNodePath('p04')}>
        Добавить опыт
      </Link>
    );
  }
  return <span className="num">{mark.caption}</span>;
}

export function MoneyCell({ item, env }: { item: MatchedVacancyItem; env: RowEnv }) {
  const money = moneyView(item, { currency: env.currency, rates: env.rates });
  const salary = item.cluster.salary;
  const unset = salary?.from === undefined && salary?.to === undefined;
  return (
    <span className={`vt-main num${unset ? ' is-none' : ''}`} title={money.title}>
      {money.amount ?? money.text}
      {money.unit ? <span className="vt-cur"> {money.unit}</span> : null}
    </span>
  );
}

/** Компания строки: ссылка на карточку v10b, а без компании — текст. */
export function CompanyName({ name }: { readonly name: string | null | undefined }) {
  const text = name?.trim() ?? '';
  const path = companyNodePath(text);
  return path ? (
    <Link className="vt-co" to={path}>
      {text}
    </Link>
  ) : (
    <span className="vt-co">{text || NO_COMPANY}</span>
  );
}

export function CompanyCell({ item, application }: { item: MatchedVacancyItem; application?: ApplicationView }) {
  return (
    <>
      <CompanyName name={item.cluster.canonicalCompany} />
      {appliedOn(application) ? (
        <span className="tag ok va-tag" role="img" aria-label="Вы откликнулись" title="Вы откликнулись">
          <Icon name="check" />
          <span className="va-tag-t" aria-hidden="true">
            Откликнулся
          </span>
        </span>
      ) : null}
    </>
  );
}

function Actions(props: VacancyRowProps) {
  const { item, application, menuView } = props;
  const saved = isSaved(application);
  const favLabel = saved ? 'Убрать из сохранённых' : 'Сохранить вакансию';
  const menuId = `va-m-${item.cluster.id}`;
  const hiding = menuView === 'hide';
  const more = menuView !== null && !hiding;
  const toggle = (view: MenuView, current: boolean) => (current ? props.onCloseMenu() : props.onMenu(view));
  return (
    <div
      className={`va${menuView ? ' has-m' : ''}`}
      role="group"
      aria-label={`Действия: ${item.cluster.canonicalTitle}, ${item.cluster.canonicalCompany ?? ''}`}
    >
      <button className={`va-b va-fav${saved ? ' is-on' : ''}`} type="button" title={favLabel} aria-label={favLabel} aria-pressed={saved} onClick={props.onToggleSaved}>
        <Icon name={saved ? 'starf' : 'star'} />
      </button>
      <button className="va-b va-no" type="button" title="Не подходит" aria-label="Не подходит" aria-expanded={hiding} aria-controls={hiding ? menuId : undefined} onClick={() => toggle('hide', hiding)}>
        <Icon name="close" />
      </button>
      <button className="va-b va-more" type="button" title="Ещё действия" aria-label="Ещё действия" aria-expanded={more} aria-controls={more ? menuId : undefined} onClick={() => toggle('list', more)}>
        <Icon name="more" />
      </button>
      {menuView ? (
        <RowMenu key={menuView} item={item} initialView={menuView} actions={props.menuActions} onClose={props.onCloseMenu} />
      ) : null}
    </div>
  );
}

/** Ячейка «Роль»: название, метка «Хочу», в режиме «Помочь выбрать» ещё флажок и причина. */
function RoleCell({ item, wanted, open, pick, onToggleOpen }: VacancyRowProps) {
  const { cluster } = item;
  return (
    <td className="vt-c vt-role">
      <div className="vt-rl">
        {pick ? (
          <input
            className="vz-ck"
            type="checkbox"
            checked={pick.checked}
            aria-label={`Скрыть: ${cluster.canonicalTitle}, ${cluster.canonicalCompany ?? ''}`}
            onChange={pick.onToggle}
          />
        ) : null}
        <button className="vt-toggle" type="button" aria-expanded={open} aria-controls={open ? `vacancy-details-${cluster.id}` : undefined} title={cluster.canonicalTitle} onClick={onToggleOpen}>
          <span>{cluster.canonicalTitle}</span>
          <Icon name="down" className="vt-chev" />
        </button>
        {pick ? <span className="vz-why">{pick.reason}</span> : null}
        {wanted ? (
          <Link className="tag va-tag vg-want" title="Хочу в компанию" to={buildNodePath('o08')}>
            <Icon name="building" />
            <span className="vh">Хочу в компанию</span>
          </Link>
        ) : null}
      </div>
    </td>
  );
}

/** Строка таблицы подборки: разметка и классы макета s07. */
export function VacancyRow(props: VacancyRowProps) {
  const { item, env, application, open, pick } = props;
  const { cluster } = item;
  const geo = rowGeo(item);
  const pending = vacancyFitMark(item.explanation.fitView).kind === 'pending';
  return (
    <tr className={`vt-row${open ? ' is-open' : ''}${pending ? ' is-counting' : ''}${pick?.checked ? ' is-pick' : ''}`}>
      <RoleCell {...props} />
      <td className="vt-c vt-company" title={cluster.canonicalCompany}>
        <CompanyCell item={item} application={application} />
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
        <Actions {...props} />
      </td>
    </tr>
  );
}
