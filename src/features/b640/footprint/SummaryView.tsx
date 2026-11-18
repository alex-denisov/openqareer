import { useState } from 'react';
import type { FootprintRiskItem, FootprintRiskSummary } from '../../../../shared/footprintRisk';
import { Button, Icon, InfoTip, Link, PagedList, StatusLine } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { FindingRow } from './FindingRow';
import { revokeAccountCapabilityConsent } from './footprintApi';
import { dayMonth, findingsWord, levelTag, pageAttrs, shortDate } from './footprintModel';
import type { FootprintData } from './useFootprint';
import { repeatIds, useStartSearch } from './useStartSearch';
import { reportFailure } from './reportFailure';

const PAGE = 20;

interface ListProps {
  readonly items: readonly FootprintRiskItem[];
  readonly showLevel?: boolean;
  readonly onChanged: () => void;
}

/** Находки списком; больше 20 — порциями с «Показать ещё». */
export function FindingList({ items, showLevel = false, onChanged }: ListProps) {
  const render = (item: FootprintRiskItem) => (
    <FindingRow key={item.id} item={item} showLevel={showLevel} onChanged={onChanged} />
  );
  if (items.length <= PAGE) return <ul className="rows exp-rows fp-finds">{items.map(render)}</ul>;
  return <PagedList items={items} renderItem={render} listClassName="rows exp-rows fp-finds" />;
}

function Categories({ summary }: { readonly summary: FootprintRiskSummary }) {
  const shown = summary.categories.filter((category) => category.count > 0);
  if (shown.length === 0) return null;
  return (
    <>
      <h3 className="pf-sub" id="fp-sum-t">Что увидит работодатель</h3>
      <ul className="fp-cats" aria-labelledby="fp-sum-t">
        {shown.map((category) => (
          <li className="fp-cat" key={category.id}>
            <div className="fp-cat-b">
              <div className="row-title">{category.title}</div>
              <div className="row-sub">
                {[findingsWord(category.count), category.where].filter(Boolean).join(' · ')}
              </div>
            </div>
            <span className={levelTag(category.level)}>{category.levelLabel}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

interface ViewProps {
  readonly data: FootprintData;
  readonly reload: () => void;
}

function SummaryLead({ data, reload }: ViewProps) {
  const { summary } = data;
  const checked = dayMonth(summary.checkedAt);
  return (
    <section className="lead" aria-labelledby="fp-title">
      <div className="lead-head">
        <h2 className="lead-title is-long" id="fp-title">{summary.headline}</h2>
        {checked ? <InfoTip label="Источник" text={`Проверено ${checked}.`} /> : null}
      </div>
      {summary.items.length > 0 ? (
        <div className="actions">
          <Link className="btn is-primary" to={buildNodePath('f03')}>
            <Icon name="list" />
            Разобрать по одной
          </Link>
        </div>
      ) : null}
      <Categories summary={summary} />
      {summary.items.length > 0 ? (
        <>
          <h3 className="pf-sub">Находки</h3>
          <FindingList items={summary.items} showLevel onChanged={reload} />
        </>
      ) : null}
    </section>
  );
}

function ChecksModule({ data, reload }: ViewProps) {
  const repeat = useStartSearch(data, reload);
  const checked = dayMonth(data.summary.checkedAt);
  return (
    <section className="mod" aria-labelledby="fp-sum">
      <h3 className="mod-title" id="fp-sum">Проверки</h3>
      {checked ? (
        <dl className="kv">
          <dt>Последняя проверка</dt>
          <dd>{checked}</dd>
        </dl>
      ) : null}
      {repeat.error ? <StatusLine state="err" text={repeat.error} /> : null}
      <div className="actions">
        <Button icon="refresh" busy={repeat.busy} onClick={() => void repeat.start(repeatIds(data))}>
          Проверить снова
        </Button>
        <Link className="row-act" to={buildNodePath('p04')}>
          <Icon name="plus" />
          Добавить опыт
        </Link>
      </div>
    </section>
  );
}

/** «Отозвать» спрашивает подтверждение на месте: находки удалятся вместе с согласием. */
function ConsentModule({ data, reload }: ViewProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const since = shortDate(data.consentGrantedAt);

  async function revoke() {
    setBusy(true);
    setError(false);
    try {
      await revokeAccountCapabilityConsent('digital_footprint');
      reload();
    } catch (reason) {
      reportFailure('согласие не отозвано', reason);
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mod" aria-labelledby="fp-cons">
      <h3 className="mod-title" id="fp-cons">Ищем только с вашего согласия</h3>
      <details className="revoke" open={open}
        onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          {since ? `Согласие дано ${since} · ` : 'Согласие дано · '}
          <span className="row-act">Отозвать</span>
        </summary>
        <div className="revoke-box" role="group" aria-label="Отозвать согласие?">
          <p className="revoke-q">Отозвать согласие? Находки удалятся.</p>
          {error ? <StatusLine state="err" text="Не удалось отозвать. Повторите." /> : null}
          <div className="actions">
            <Button variant="danger" busy={busy} onClick={() => void revoke()}>Отозвать</Button>
            <Button variant="quiet" onClick={() => setOpen(false)}>Оставить</Button>
          </div>
        </div>
      </details>
    </section>
  );
}

/** P2: сводка следа, находки, проверки и согласие. */
export function SummaryView({ node, data, reload }: ViewProps & { readonly node: B640Node }) {
  return (
    <div className="page two" {...pageAttrs(node)}>
      <div className="col">
        <SummaryLead data={data} reload={reload} />
      </div>
      <div className="col">
        <ChecksModule data={data} reload={reload} />
        <ConsentModule data={data} reload={reload} />
      </div>
    </div>
  );
}
