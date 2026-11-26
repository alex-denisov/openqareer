import { useState } from 'react';
import {
  cancelCandidateBillingRenewal,
  getCandidateBillingReceipts,
  getCandidateBillingSummary,
  type CandidateBillingReceipt,
  type CandidateBillingSummary,
} from '../../shell/candidateBillingApi';
import { Dialog } from '../kit/Dialog';
import { buildNodePath, type B640Node } from '../routes';
import { Link } from '../shell/Link';
import { useShell } from '../shell/ShellContext';
import { isPaidPlan, PAY_PARAM, receiptLine, renewalLine, subscriptionLine, tierOf } from './billingModel';
import { CheckoutScreen } from './CheckoutScreen';
import { LIVE_CONSULTANT_PRICE, LiveConsultantRequest } from './LiveConsultant';
import { ErrorLine, SettingsPage, useLoad, type Load } from './parts';

const TARIFFS_PATH = buildNodePath('t01');
const PAGE = 20;

interface Billing {
  readonly summary: CandidateBillingSummary;
  readonly receipts: readonly CandidateBillingReceipt[];
  readonly nextCursor: string | null;
}

async function loadBilling(): Promise<Billing> {
  const [summary, page] = await Promise.all([
    getCandidateBillingSummary(),
    getCandidateBillingReceipts({ limit: PAGE }),
  ]);
  return { summary, receipts: page.receipts, nextCursor: page.nextCursor };
}

/** Запрос по кнопке: ожидание и ошибка на месте. */
function useRequest() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setFailed(false);
    try {
      await action();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return { busy, failed, run: (action: () => Promise<void>) => void run(action) };
}

interface PartProps {
  readonly billing: Billing;
  readonly load: Load<Billing>;
}

/** Автопродление выключается с подтверждением: включить его обратно можно только новой оплатой. */
function Renewal({ billing, load }: PartProps) {
  const [asking, setAsking] = useState(false);
  const { busy, failed, run } = useRequest();
  const { subscription } = billing.summary;
  if (!subscription) return null;
  const cancel = () =>
    run(async () => {
      await cancelCandidateBillingRenewal();
      setAsking(false);
      load.retry();
    });
  return (
    <li className="set-row">
      <div className="set-l">
        <span className="set-t">Автопродление</span>
        <span className="set-v">{renewalLine(billing.summary)}</span>
      </div>
      <div className="set-r">
        <span className="sw-cell">
          <input
            className="sw"
            type="checkbox"
            role="switch"
            aria-label="Автопродление"
            checked={subscription.autoRenew}
            disabled={!subscription.autoRenew}
            onChange={() => setAsking(true)}
          />
        </span>
      </div>
      <Dialog open={asking} title="Отключить автопродление?" onClose={() => setAsking(false)}>
        <p className="c5-lead">
          {renewalLine({ ...billing.summary, subscription: { ...subscription, autoRenew: false } })}. Включить
          снова можно только новой оплатой.
        </p>
        {failed ? <ErrorLine text="Не отключилось" /> : null}
        <div className="actions">
          <button className="btn is-primary" type="button" disabled={busy} aria-busy={busy || undefined} onClick={cancel}>
            Отключить
          </button>
          <button className="btn" type="button" onClick={() => setAsking(false)}>
            Оставить
          </button>
        </div>
      </Dialog>
    </li>
  );
}

function Subscription({ billing, load }: PartProps) {
  const { summary } = billing;
  return (
    <section className="set-group" aria-label="Подписка">
      <h3 className="set-h">Подписка</h3>
      <ul className="set-list">
        <li className="set-row">
          <div className="set-l">
            <span className="set-t">{tierOf(summary.currentPlan).name}</span>
            <span className="set-v">{subscriptionLine(summary)}</span>
          </div>
          <div className="set-r">
            <Link className="btn is-sm" to={TARIFFS_PATH}>
              Сменить тариф
            </Link>
          </div>
        </li>
        <Renewal billing={billing} load={load} />
      </ul>
    </section>
  );
}

/** Чек открывается на странице оператора: ссылка только по https. */
function receiptHref(receipt: CandidateBillingReceipt): string | null {
  try {
    const url = receipt.receiptUrl ? new URL(receipt.receiptUrl) : null;
    return url?.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function ReceiptRow({ receipt }: { readonly receipt: CandidateBillingReceipt }) {
  const line = receiptLine(receipt);
  const href = receiptHref(receipt);
  return (
    <li className="set-row">
      <div className="set-l">
        <span className="set-t">{line.title}</span>
        <span className="set-v">{line.value}</span>
      </div>
      {href ? (
        <div className="set-r">
          <a className="btn is-sm" href={href} target="_blank" rel="noopener noreferrer" aria-label={`Чек: ${line.value}`}>
            Чек
          </a>
        </div>
      ) : null}
    </li>
  );
}

/** «Платежи и чеки»: по 20, «Показать ещё»; платежей нет — одна строка, у Free ещё путь к тарифам (T3f). */
function Receipts({ billing, load }: PartProps) {
  const { busy, failed, run } = useRequest();
  const more = () =>
    run(async () => {
      if (!billing.nextCursor) return;
      const page = await getCandidateBillingReceipts({ cursor: billing.nextCursor, limit: PAGE });
      load.update((current) => ({
        ...current,
        receipts: [...current.receipts, ...page.receipts],
        nextCursor: page.nextCursor,
      }));
    });
  return (
    <section className="set-group" aria-label="Платежи и чеки">
      <h3 className="set-h">Платежи и чеки</h3>
      <ul className="set-list">
        {billing.receipts.map((receipt) => (
          <ReceiptRow key={receipt.invoiceId} receipt={receipt} />
        ))}
        {billing.receipts.length === 0 ? (
          <li className="set-row">
            <div className="set-l">
              <span className="set-t">Платежей нет</span>
            </div>
            {billing.summary.currentPlan === 'free' ? (
              <div className="set-r">
                <Link className="btn is-sm" to={TARIFFS_PATH}>
                  Выбрать тариф
                </Link>
              </div>
            ) : null}
          </li>
        ) : null}
        {failed ? (
          <li className="set-foot">
            <ErrorLine text="Платежи не загрузились" onRetry={more} />
          </li>
        ) : null}
        {billing.nextCursor && !failed ? (
          <li className="set-foot">
            <button className="btn is-sm" type="button" disabled={busy} aria-busy={busy || undefined} onClick={more}>
              Показать ещё
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function LiveConsultantRow() {
  return (
    <section className="set-group" aria-label="Живой консультант">
      <ul className="set-list">
        <li className="set-row">
          <div className="set-l">
            <span className="set-t">Живой консультант</span>
            <span className="set-v">{LIVE_CONSULTANT_PRICE}</span>
          </div>
          <div className="set-r">
            <LiveConsultantRequest />
          </div>
        </li>
      </ul>
    </section>
  );
}

/** t03 «Подписка и оплата»; с параметром `?pay=<тариф>` — подтверждение перед оплатой (T3b). */
export function BillingScreen({ node }: { readonly node: B640Node }) {
  const { search } = useShell();
  const load = useLoad(loadBilling);
  const pay = new URLSearchParams(search).get(PAY_PARAM);
  if (isPaidPlan(pay) && load.state === 'ready') {
    return <CheckoutScreen node={node} summary={load.data.summary} planId={pay} onPaid={load.retry} />;
  }
  return (
    <SettingsPage node={node} heading="Подписка и оплата" busy={load.state === 'loading'}>
      {load.state === 'error' ? <ErrorLine text="Раздел не загрузился" onRetry={load.retry} /> : null}
      {load.state === 'ready' ? (
        <>
          <Subscription billing={load.data} load={load} />
          <Receipts billing={load.data} load={load} />
          <LiveConsultantRow />
        </>
      ) : null}
    </SettingsPage>
  );
}
