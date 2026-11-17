import { useCallback } from 'react';
import { getApplicationFunnel, type ApplicationFunnel } from '../../applications/applicationsApi';
import { TARIFF_LEVELS } from '../../tariffs/tariffsData';
import { QUOTA_PLAN_NAMES, type TariffQuotaStatus } from '../../tariffs/tariffQuotaApi';
import { Icon, Link } from '../kit';
import { useAsync } from '../responses/data/useAsync';
import { pluralRu } from '../responses/model/responseRow';
import { buildNodePath } from '../routes';
import type { ApplyHead } from './model/applyModel';

const FREE = [
  'Вакансии',
  'Процент совпадения',
  'Резюме под вакансию',
  'Вопросы к интервью',
  'Подготовка ответов',
] as const;

/** «20 откликов → 4 ответа → 1 интервью» по воронке кандидата. */
export function funnelLine(funnel: ApplicationFunnel): string {
  const interview = funnel.interview + funnel.offer;
  const answered = funnel.responded + interview + funnel.rejected;
  const sent = funnel.applied + answered;
  return [
    `${sent} ${pluralRu(sent, ['отклик', 'отклика', 'откликов'])}`,
    `${answered} ${pluralRu(answered, ['ответ', 'ответа', 'ответов'])}`,
    `${interview} интервью`,
  ].join(' → ');
}

function FreeList() {
  return (
    <div className="col">
      <section className="mod" aria-labelledby="pm-free">
        <h3 className="mod-title" id="pm-free">
          Что остаётся бесплатно
        </h3>
        <ul className="cons-list">
          {FREE.map((item) => (
            <li key={item}>
              <Icon name="check" />
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export interface QuotaBlockProps {
  readonly head: ApplyHead;
  readonly quota: TariffQuotaStatus;
}

/** «Отклики закончились» (T2): следующий тариф, свои итоги и что остаётся бесплатно. */
export function QuotaBlock({ head, quota }: QuotaBlockProps) {
  const load = useCallback((signal: AbortSignal) => getApplicationFunnel(signal), []);
  const { state } = useAsync(load, '');
  const plan = quota.upgradePlan ? QUOTA_PLAN_NAMES[quota.upgradePlan] : null;
  const level = TARIFF_LEVELS.find((item) => item.name === plan);
  return (
    <>
      <div className="col">
        <section className="lead" aria-labelledby="pm-title">
          <h2 className="lead-title is-long" id="pm-title">
            Отклики закончились
          </h2>
          <p className="lead-sub">{[head.company, head.title].filter(Boolean).join(' · ')}</p>
          <dl className="kv">
            {level ? (
              <>
                <dt>{level.name}</dt>
                <dd>{`${level.price} · ${level.term}`}</dd>
              </>
            ) : null}
            {state.data ? (
              <>
                <dt>Ваши итоги</dt>
                <dd>{funnelLine(state.data)}</dd>
              </>
            ) : null}
          </dl>
          <div className="actions">
            <Link className="btn is-primary" to={buildNodePath('t03')}>
              <Icon name="wallet" />
              {plan ? `Перейти на ${plan}` : 'Посмотреть тарифы'}
            </Link>
            <Link className="btn" to={buildNodePath('o01')}>
              <Icon name="clock" />
              Отложить
            </Link>
          </div>
        </section>
      </div>
      <FreeList />
    </>
  );
}
