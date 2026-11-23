import { useEffect, useState } from 'react';
import type { OwnVacancy, OwnVacancyDetail } from '../../../../../shared/b640OwnVacancy';
import type { VacancyFitView } from '../../../../../shared/vacancyFit';
import { workFormatLabel } from '../../../../../shared/vacancyWorkFormat';
import { Icon, useIsMobile } from '../../kit';
import { fitRows } from '../card/fitRows';
import { RequirementList } from '../card/RequirementList';
import { textBlocks } from '../card/textBlocks';
import { isoRowDate, safeHttpUrl, salaryMoneyView, type MoneyOptions } from '../format';
import { getOwnVacancy } from '../ownVacancyApi';
import { ownNoScoreReason } from './ownNoScore';
import { OwnMenu } from './OwnMenu';

/** «3 из 5» в колонке совпадения: процента у своей вакансии нет. */
function CoverageCell({ item }: { item: OwnVacancy }) {
  if (item.coverage) {
    return (
      <span className="num">
        {item.coverage.matched} из {item.coverage.total}
        <span className="vh"> требований есть в профиле</span>
      </span>
    );
  }
  if (item.comparing) {
    return (
      <span className="vt-counting">
        <Icon name="hourglass" />
        считаем
      </span>
    );
  }
  return <span className="num">—</span>;
}

function coverageLabel(view: VacancyFitView, count: number): string {
  const coverage = view.result?.coverage;
  return coverage && coverage.total > 0
    ? `Требования: ${coverage.matched} из ${coverage.total} есть в профиле`
    : `Требования из текста вакансии · ${count}`;
}

function useDetail(id: string): OwnVacancyDetail | null | 'failed' {
  const [detail, setDetail] = useState<OwnVacancyDetail | null | 'failed'>(null);
  useEffect(() => {
    const controller = new AbortController();
    getOwnVacancy(id, controller.signal).then(setDetail, () => {
      if (!controller.signal.aborted) setDetail('failed');
    });
    return () => controller.abort();
  }, [id]);
  return detail;
}

function OwnText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="v4-box">
      <button className="v4-req-row" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>Текст вакансии</span>
        <Icon name="down" className="v4-chev" />
      </button>
      {open ? (
        <div className="v4-reqs-open">
          {textBlocks(text).map((block, index) =>
            block.kind === 'h' ? <h4 key={index}>{block.text}</h4> : <p key={index}>{block.text}</p>,
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Без счёта — почему, словами; найденные требования видны, даже если ни одно не навык. */
function NoScore({ view, listed }: { view: VacancyFitView; listed: boolean }) {
  const reason = ownNoScoreReason(view);
  if (!reason) return null;
  const others = listed ? [] : view.requirements;
  return (
    <div className={others.length > 0 ? 'v4-box v4-reqs-box' : 'v4-box'}>
      <p className="v4-req-row">{reason}</p>
      {others.length > 0 ? (
        <div className="v4-reqs-open">
          <ul className="v4-fd-l">
            {others.map((item) => <li key={item.id}><span className="v4-fd-r">{item.label?.trim() || item.text}</span></li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function OwnDetailBody({ detail }: { detail: OwnVacancyDetail }) {
  const rows = fitRows(detail.fit);
  const url = safeHttpUrl(detail.url);
  return (
    <>
      <p className="v4-one">Сравнение с одной вакансией — не оценка рынка</p>
      {rows.length > 0 ? (
        <div className="v4-box v4-reqs-box">
          <p className="v4-req-row">{coverageLabel(detail.fit, rows.length)}</p>
          <div className="v4-reqs-open">
            <RequirementList rows={rows} />
          </div>
        </div>
      ) : null}
      <NoScore view={detail.fit} listed={rows.length > 0} />
      <OwnText text={detail.text} />
      {url ? (
        <a className="row-act vs-open" href={url} target="_blank" rel="noopener noreferrer" aria-label="Открыть на сайте">
          <Icon name="out" />
          <span className="vs-open-t">Открыть на сайте</span>
        </a>
      ) : null}
    </>
  );
}

function OwnDetail({ item }: { item: OwnVacancy }) {
  const detail = useDetail(item.id);
  return (
    <tr className="vt-detail-row">
      <td colSpan={8}>
        <section className="vd vs" id={`vacancy-details-${item.id}`} aria-label={`Ваша вакансия: ${item.title}`}>
          {detail === null ? (
            <p className="va-add-st" role="status" aria-busy="true"><Icon name="hourglass" />Загружаем…</p>
          ) : detail === 'failed' ? (
            <p className="va-add-st" role="alert">Не удалось открыть вакансию</p>
          ) : (
            <OwnDetailBody detail={detail} />
          )}
        </section>
      </td>
    </tr>
  );
}

/** B676: деньги своей вакансии — тем же правилом, что у строк подборки (в месяц, в валюте списка). */
function OwnMoney({ item, money }: { item: OwnVacancy; money: MoneyOptions }) {
  const view = salaryMoneyView(item.salary ?? undefined, money);
  const unset = item.salary?.from === undefined && item.salary?.to === undefined;
  return (
    <span className={`vt-main num${unset ? ' is-none' : ''}`} title={view.title}>
      {view.amount ?? view.text}
      {view.unit ? <span className="vt-cur"> {view.unit}</span> : null}
    </span>
  );
}

interface OwnRowProps {
  readonly item: OwnVacancy;
  readonly money: MoneyOptions;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onRemove: () => void;
  /** Окно «…» на 390 (B676): одно на список, как у строк подборки. */
  readonly menuOpen: boolean;
  readonly onMenu: (open: boolean) => void;
}

function OwnRow({ item, money, open, onToggle, onRemove, menuOpen, onMenu }: OwnRowProps) {
  const mobile = useIsMobile();
  const place = item.location ?? (item.workFormat === 'remote' ? 'Удалённо' : 'Не указана');
  return (
    <tr className={`vt-row${open ? ' is-open' : ''}${item.comparing ? ' is-counting' : ''}`}>
      <td className="vt-c vt-role">
        <div className="vt-rl">
          <button className="vt-toggle" type="button" aria-expanded={open} aria-controls={open ? `vacancy-details-${item.id}` : undefined} title={item.title} onClick={onToggle}>
            <span>{item.title}</span>
            <Icon name="down" className="vt-chev" />
          </button>
          <span className="tag va-tag va-mine" title="Видна только вам">
            ваша<span className="vh">, видна только вам</span>
          </span>
        </div>
      </td>
      <td className="vt-c vt-company" title={item.company ?? undefined}>{item.company ?? '—'}</td>
      <td className="vt-c vt-money"><OwnMoney item={item} money={money} /></td>
      <td className="vt-c vt-fitc"><CoverageCell item={item} /></td>
      <td className="vt-c vt-geo" title={place}>{place}</td>
      <td className="vt-c vt-format">{item.workFormat ? workFormatLabel(item.workFormat) ?? '' : ''}</td>
      <td className="vt-c vt-date num">{isoRowDate(item.createdAt)}</td>
      <td className="vt-c vt-acts">
        <div className={`va${menuOpen ? ' has-m' : ''}`} role="group" aria-label={`Действия: ${item.title}`}>
          <button className="va-b va-no" type="button" title="Удалить" aria-label={`Удалить: ${item.title}`} onClick={onRemove}>
            <Icon name="trash" />
          </button>
          {mobile ? <button className="va-b va-more" type="button" title="Ещё действия" aria-label="Ещё действия" aria-expanded={menuOpen} aria-controls={menuOpen ? `va-m-${item.id}` : undefined} onClick={() => onMenu(!menuOpen)}>
            <Icon name="more" />
          </button> : null}
          {menuOpen ? <OwnMenu id={item.id} title={item.title} onRemove={onRemove} onClose={() => onMenu(false)} /> : null}
        </div>
      </td>
    </tr>
  );
}

export interface OwnRowsProps {
  readonly items: readonly OwnVacancy[];
  /** Валюта и курс списка: деньги своей вакансии показываются как у строк подборки. */
  readonly money: MoneyOptions;
  readonly onRemove: (id: string) => void;
}

/** Свои вакансии кандидата первыми строками таблицы с меткой «ваша» (макет v06c). */
export function OwnRows({ items, money, onRemove }: OwnRowsProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  if (items.length === 0) return null;
  return (
    <tbody className="vt-own">
      {items.flatMap((item) => {
        const open = openId === item.id;
        const row = (
          <OwnRow key={item.id} item={item} money={money} open={open} onToggle={() => setOpenId(open ? null : item.id)} onRemove={() => onRemove(item.id)} menuOpen={menuId === item.id} onMenu={(next) => setMenuId(next ? item.id : null)} />
        );
        return open ? [row, <OwnDetail key={`${item.id}-detail`} item={item} />] : [row];
      })}
    </tbody>
  );
}
