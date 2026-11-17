import { Fragment, useState } from 'react';
import type { CandidateBillingPlanId, CandidateBillingSummary } from '../../shell/candidateBillingApi';
import {
  createCandidateCheckout,
  getCandidateCheckout,
  type CandidateCheckout,
} from '../../tariffs/tariffUpgradeApi';
import { Icon } from '../kit/Icon';
import { useToast } from '../kit/Toast';
import { buildNodePath, type B640Node } from '../routes';
import { Link } from '../shell/Link';
import { useScreenChrome, useShell } from '../shell/ShellContext';
import { checkoutLines, safePaymentUrl, tierOf } from './billingModel';
import { ErrorLine } from './parts';

export interface CheckoutScreenProps {
  readonly node: B640Node;
  readonly summary: CandidateBillingSummary;
  readonly planId: CandidateBillingPlanId;
  /** Оплата прошла: подписка перечитывается. */
  readonly onPaid: () => void;
}

type Problem = 'start' | 'check' | 'declined' | 'waiting' | null;

const PROBLEM_TEXT: Readonly<Record<Exclude<Problem, 'declined' | null>, string>> = {
  start: 'Счёт не создался',
  check: 'Проверить оплату не получилось',
  waiting: 'Оплата ещё не пришла',
};

/**
 * Счёт на оплату. Создаётся только по нажатию «Перейти к оплате»; деньги списывает банк на
 * своей странице. Автопродление не включается: согласия на повторные списания макет не берёт.
 */
function useCheckout(planId: CandidateBillingPlanId, onPaid: (checkout: CandidateCheckout) => void) {
  // Ключ счёта живёт до отказа: отклонённый счёт повторяется уже с новым ключом.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [checkout, setCheckout] = useState<CandidateCheckout | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);

  async function run(kind: 'start' | 'check', action: () => Promise<CandidateCheckout>) {
    setBusy(true);
    setProblem(null);
    try {
      const next = await action();
      setCheckout(next);
      if (next.status === 'paid') onPaid(next);
      else if (next.status === 'failed') setProblem('declined');
      else if (kind === 'check') setProblem('waiting');
      if (next.status === 'failed') setKey(crypto.randomUUID());
    } catch {
      setProblem(kind);
      if (kind === 'start') setKey(crypto.randomUUID());
    } finally {
      setBusy(false);
    }
  }
  return {
    checkout,
    busy,
    problem,
    start: () => void run('start', () => createCandidateCheckout({ planId, autoRenew: false, idempotencyKey: key })),
    check: () => checkout && void run('check', () => getCandidateCheckout(checkout.invoiceId)),
  };
}

function Declined() {
  return (
    <div className="c12-alert" role="alert">
      <Icon name="warn" />
      <div>
        <p className="c12-alert-t">Банк отклонил платёж</p>
        <p className="c12-alert-s">Деньги не списаны.</p>
      </div>
    </div>
  );
}

interface ActionsProps {
  readonly flow: ReturnType<typeof useCheckout>;
  readonly verified: boolean;
  readonly stayLabel: string;
}

/** Кнопки шага: сначала «Перейти к оплате», после счёта — страница банка и «Проверить оплату». */
function Actions({ flow, verified, stayLabel }: ActionsProps) {
  const paymentUrl = safePaymentUrl(flow.checkout?.paymentUrl ?? null);
  const stay = (
    <Link className="btn is-quiet" to={buildNodePath('t01')}>
      <Icon name="back" />
      {stayLabel}
    </Link>
  );
  if (!flow.checkout || flow.checkout.status === 'failed' || !paymentUrl) {
    return (
      <div className="actions">
        <button className="btn is-primary" type="button" disabled={!verified || flow.busy} aria-busy={flow.busy || undefined} onClick={flow.start}>
          <Icon name="out" />
          Перейти к оплате
        </button>
        {stay}
      </div>
    );
  }
  return (
    <div className="actions">
      <a className="btn is-primary" href={paymentUrl} target="_blank" rel="noopener noreferrer">
        <Icon name="out" />
        Открыть страницу оплаты
      </a>
      <button className="btn" type="button" disabled={flow.busy} aria-busy={flow.busy || undefined} onClick={flow.check}>
        Проверить оплату
      </button>
      {stay}
    </div>
  );
}

/** T3b «Перейти к оплате»: тариф, сумма, период — и только затем счёт и страница банка. */
export function CheckoutScreen({ node, summary, planId, onPaid }: CheckoutScreenProps) {
  const { session, navigate } = useShell();
  const toast = useToast();
  const name = tierOf(planId).name;
  useScreenChrome({ crumb: 'Переход к оплате' });
  const flow = useCheckout(planId, () => {
    onPaid();
    toast.show({ text: `${name} подключён` });
    navigate(buildNodePath('t03'));
  });
  const verified = session.emailVerified === true;
  const { problem } = flow;
  return (
    <div className="page" data-b640-node={node.code} data-b640-section={node.section} data-b640-view="checkout">
      <div className="col t3-col">
        <section className="lead" aria-labelledby="b640-pay-title">
          <h2 className="lead-title is-long" id="b640-pay-title">
            Перейти к оплате {name}
          </h2>
          <dl className="kv">
            {checkoutLines(summary, planId).map(([label, value]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd className={label === 'Сумма' ? 'num' : undefined}>{value}</dd>
              </Fragment>
            ))}
          </dl>
          {problem === 'declined' ? <Declined /> : null}
          {problem && problem !== 'declined' ? <ErrorLine text={PROBLEM_TEXT[problem]} /> : null}
          {verified ? null : (
            <p className="set-res is-err" role="alert">
              <span>Сначала подтвердите почту</span>
              <Link className="btn is-sm" to={buildNodePath('n04')}>
                Открыть
              </Link>
            </p>
          )}
          <Actions flow={flow} verified={verified} stayLabel={`Остаться на ${tierOf(summary.currentPlan).name}`} />
        </section>
      </div>
    </div>
  );
}
