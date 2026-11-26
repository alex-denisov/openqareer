import { Fragment } from 'react';
import { getCandidateBillingSummary, type CandidateBillingSummary } from '../../shell/candidateBillingApi';
import { Icon } from '../kit/Icon';
import type { B640Node } from '../routes';
import { Link } from '../shell/Link';
import {
  isPaidPlan,
  payUrl,
  planPrice,
  TARIFF_INCLUDED,
  TARIFF_TIERS,
  tierOf,
  type TariffTier,
} from './billingModel';
import { LIVE_CONSULTANT_PRICE, LiveConsultantRequest } from './LiveConsultant';
import { ErrorLine, useLoad } from './parts';

/** Тариф, на который ведёт главная кнопка: следующий после текущего. */
function nextTier(summary: CandidateBillingSummary): TariffTier | null {
  const index = TARIFF_TIERS.findIndex((tier) => tier.id === summary.currentPlan);
  return TARIFF_TIERS[index + 1] ?? null;
}

function Quota({ label, value }: { readonly label: string; readonly value: string | null }) {
  return (
    <li>
      {label}
      <b className="num">{value ?? '—'}</b>
    </li>
  );
}

interface TierProps {
  readonly tier: TariffTier;
  readonly summary: CandidateBillingSummary;
  readonly state: 'now' | 'next' | 'above' | 'below';
}

function TierCard({ tier, summary, state }: TierProps) {
  const price = planPrice(summary, tier.id);
  const headingId = `b640-tier-${tier.id}`;
  const canBuy = isPaidPlan(tier.id) && price !== null && (state === 'next' || state === 'above');
  const stateClass = state === 'now' || state === 'next' ? state : '';
  return (
    <article className={`tier ${stateClass}`.trim()} data-t={tier.name} aria-labelledby={headingId}>
      <h3 id={headingId}>
        {tier.name}
        {state === 'now' ? <span className="tag">Ваш тариф</span> : null}
      </h3>
      <p className="tier-line">{tier.line}</p>
      {price ? (
        <div className="price num">
          {price}
          {tier.id === 'free' ? null : <small> в месяц</small>}
        </div>
      ) : null}
      <ul>
        <Quota label="Отклики" value={tier.applications} />
        <Quota label="Сообщения консультанту" value={tier.coachTurns} />
        <Quota label="Пробные интервью" value={tier.interviews} />
        <Quota label="Посты LinkedIn" value={tier.posts} />
        {tier.id === 'free'
          ? TARIFF_INCLUDED.map((item) => (
              <li key={item}>
                {item}
                <b className="tier-yes" role="img" aria-label="входит">
                  <Icon name="check" />
                </b>
              </li>
            ))
          : null}
      </ul>
      {canBuy && isPaidPlan(tier.id) ? (
        <Link className={state === 'next' ? 'btn is-primary' : 'btn'} to={payUrl(tier.id)}>
          <Icon name={state === 'next' ? 'bolt' : 'wallet'} />
          Перейти на {tier.name}
        </Link>
      ) : null}
    </article>
  );
}

function tierState(tier: TariffTier, summary: CandidateBillingSummary): TierProps['state'] {
  const order = TARIFF_TIERS.map((item) => item.id);
  const current = order.indexOf(summary.currentPlan);
  const own = order.indexOf(tier.id);
  if (own === current) return 'now';
  if (own < current) return 'below';
  return tier.id === nextTier(summary)?.id ? 'next' : 'above';
}

function Tiers({ summary }: { readonly summary: CandidateBillingSummary }) {
  const shown = (nextTier(summary) ?? tierOf(summary.currentPlan)).name;
  const current = tierOf(summary.currentPlan);
  return (
    <section className="lead tf-wrap" aria-labelledby="b640-tariffs-title">
      <h2 className="lead-title is-long" id="b640-tariffs-title">
        Сколько откликов на подходящие роли openqareer берёт на себя
      </h2>
      <div className="tf-now">
        <span>Ваш тариф</span>
        <b>{current.name}</b>
        <span className="num">{current.applications.split(' · ')[0]} откликов в месяц</span>
      </div>
      <div className="seg tf-seg" role="radiogroup" aria-label="Тариф">
        {TARIFF_TIERS.map((tier) => (
          <Fragment key={tier.id}>
            <input className="vh" type="radio" name="tier" id={`tr-${tier.name}`} defaultChecked={tier.name === shown} />
            <label className="seg-i" htmlFor={`tr-${tier.name}`}>
              {tier.name}
            </label>
          </Fragment>
        ))}
      </div>
      <div className="tiers">
        {TARIFF_TIERS.map((tier) => (
          <TierCard key={tier.id} tier={tier} summary={summary} state={tierState(tier, summary)} />
        ))}
        <section className="cons-card cons-slim" aria-labelledby="b640-live-title">
          <h3 id="b640-live-title">Живой консультант</h3>
          <div className="price num">{LIVE_CONSULTANT_PRICE}</div>
          <LiveConsultantRequest />
        </section>
      </div>
    </section>
  );
}

/** t01 «Тарифы»: четыре тарифа с квотами и заявка на живого консультанта. */
export function TariffsScreen({ node }: { readonly node: B640Node }) {
  const load = useLoad(getCandidateBillingSummary);
  return (
    <div
      className="page"
      data-b640-node={node.code}
      data-b640-section={node.section}
      aria-busy={load.state === 'loading' || undefined}
    >
      {load.state === 'error' ? <ErrorLine text="Тарифы не загрузились" onRetry={load.retry} /> : null}
      {load.state === 'ready' ? <Tiers summary={load.data} /> : null}
    </div>
  );
}
