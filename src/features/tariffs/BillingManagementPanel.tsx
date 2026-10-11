import { useId } from 'react';
import { ArrowClockwise, SpinnerGap } from '@phosphor-icons/react';
import type {
  CandidateBillingReceipt,
  CandidateBillingSummary,
} from '../shell/candidateBillingApi';

if (typeof document !== 'undefined') {
  void import('./billing-management.css');
}

type CancellationState = 'idle' | 'pending' | 'done' | 'error';

export interface BillingManagementPanelProps {
  readonly summary: CandidateBillingSummary;
  readonly receipts: readonly CandidateBillingReceipt[];
  readonly receiptState: 'loading' | 'ready' | 'error';
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
  readonly loadMoreError: boolean;
  readonly cancellationState: 'idle' | 'pending' | 'done' | 'error';
  readonly onCancelRenewal: () => void;
  readonly onRetryReceipts: () => void;
  readonly onLoadMore: () => void;
}

export function BillingManagementPanel({
  summary,
  receipts,
  receiptState,
  nextCursor,
  loadingMore,
  loadMoreError,
  cancellationState,
  onCancelRenewal,
  onRetryReceipts,
  onLoadMore,
}: BillingManagementPanelProps) {
  const id = useId();
  return (
    <div className="career-billing-management">
      <BillingOverview
        summary={summary}
        titleId={`career-billing-title-${id}`}
        cancellationState={cancellationState}
        onCancelRenewal={onCancelRenewal}
      />
      <BillingHistory
        historyId={`career-billing-history-title-${id}`}
        receipts={receipts}
        receiptState={receiptState}
        plans={summary.plans}
        nextCursor={nextCursor}
        loadingMore={loadingMore}
        loadMoreError={loadMoreError}
        onRetry={onRetryReceipts}
        onLoadMore={onLoadMore}
      />
    </div>
  );
}

function BillingOverview({
  summary,
  titleId,
  cancellationState,
  onCancelRenewal,
}: {
  readonly summary: CandidateBillingSummary;
  readonly titleId: string;
  readonly cancellationState: CancellationState;
  readonly onCancelRenewal: () => void;
}) {
  const subscription = summary.subscription;
  const plan = subscription
    ? summary.plans.find((candidatePlan) => candidatePlan.id === summary.currentPlan)
    : undefined;
  const currentPlanName = summary.currentPlan === 'free'
    ? 'Free'
    : summary.plans.find((candidatePlan) => candidatePlan.id === summary.currentPlan)?.name ?? 'Платный тариф';
  const hasNextCharge = Boolean(
    subscription?.status === 'active' && subscription.autoRenew && subscription.nextChargeAt,
  );
  const chargeAmount = plan ? formatRubles(plan.amountKopecks) : null;

  return (
    <section className="career-billing-overview" aria-labelledby={titleId}>
      <BillingOverviewIdentity currentPlanName={currentPlanName} subscription={subscription} titleId={titleId} />
      <BillingSummaryFacts
        subscription={subscription}
        hasNextCharge={hasNextCharge}
        chargeAmount={chargeAmount}
      />
      <BillingCancellationActions
        subscription={subscription}
        state={cancellationState}
        onCancel={onCancelRenewal}
      />
    </section>
  );
}

function BillingOverviewIdentity({
  currentPlanName,
  subscription,
  titleId,
}: {
  readonly currentPlanName: string;
  readonly subscription: CandidateBillingSummary['subscription'];
  readonly titleId: string;
}) {
  return (
    <div className="career-billing-overview-main">
      <p className="career-billing-eyebrow">Ваш тариф</p>
      <h3 className="career-billing-title" id={titleId}>{currentPlanName}</h3>
      {subscription?.status === 'past_due' ? (
        <p className="career-billing-status is-warning" role="status">
          Платёж за следующий период ещё не подтверждён.
        </p>
      ) : subscription ? (
        <p className="career-billing-status" role="status">
          {subscription.autoRenew ? 'Подписка активна' : 'Автопродление выключено'}
        </p>
      ) : (
        <p className="career-billing-status">Списаний пока нет.</p>
      )}
    </div>
  );
}

function BillingSummaryFacts({
  subscription,
  hasNextCharge,
  chargeAmount,
}: {
  readonly subscription: CandidateBillingSummary['subscription'];
  readonly hasNextCharge: boolean;
  readonly chargeAmount: string | null;
}) {
  return (
    <dl className="career-billing-facts">
      {subscription ? (
        hasNextCharge ? (
          <>
            <div className="career-billing-fact">
              <dt>Следующее списание</dt>
              <dd>{formatDate(subscription.nextChargeAt)}</dd>
            </div>
            <div className="career-billing-fact">
              <dt>Сумма</dt>
              <dd>{chargeAmount ?? 'Сумма не указана'}</dd>
            </div>
          </>
        ) : (
          <div className="career-billing-fact">
            <dt>Доступ действует до</dt>
            <dd>{formatDate(subscription.currentPeriodEndsAt)}</dd>
          </div>
        )
      ) : (
        <div className="career-billing-fact">
          <dt>Оплаченных периодов</dt>
          <dd>Нет</dd>
        </div>
      )}
    </dl>
  );
}

function BillingCancellationActions({
  subscription,
  state,
  onCancel,
}: {
  readonly subscription: CandidateBillingSummary['subscription'];
  readonly state: CancellationState;
  readonly onCancel: () => void;
}) {
  if (!subscription || (!subscription.autoRenew && state !== 'done' && state !== 'error')) return null;
  return (
    <div className="career-billing-action">
      {subscription.autoRenew ? <CancelRenewalButton state={state} onCancel={onCancel} /> : null}
      {state === 'error' ? (
        <p className="career-billing-error" role="alert">
          Не удалось отключить автопродление. Проверьте соединение и повторите.
        </p>
      ) : null}
      {state === 'done' ? (
        <p className="career-billing-success" role="status">
          Автопродление отключено. Доступ действует до {formatDate(subscription.currentPeriodEndsAt)}.
        </p>
      ) : null}
    </div>
  );
}

function CancelRenewalButton({
  state,
  onCancel,
}: {
  readonly state: CancellationState;
  readonly onCancel: () => void;
}) {
  const pending = state === 'pending';
  return (
    <button
      className="career-btn career-btn-secondary"
      type="button"
      aria-disabled={pending}
      aria-busy={pending}
      onClick={onCancel}
    >
      {pending ? (
        <>
          <SpinnerGap className="career-billing-spinner career-billing-icon" aria-hidden="true" />
          Отключаем автопродление
        </>
      ) : (
        'Отключить автопродление'
      )}
    </button>
  );
}

function BillingHistory({
  historyId,
  receipts,
  receiptState,
  plans,
  nextCursor,
  loadingMore,
  loadMoreError,
  onRetry,
  onLoadMore,
}: {
  readonly historyId: string;
  readonly receipts: readonly CandidateBillingReceipt[];
  readonly receiptState: 'loading' | 'ready' | 'error';
  readonly plans: CandidateBillingSummary['plans'];
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
  readonly loadMoreError: boolean;
  readonly onRetry: () => void;
  readonly onLoadMore: () => void;
}) {
  return (
    <section className="career-billing-history" aria-labelledby={historyId}>
      <BillingHistoryHeading historyId={historyId} loading={receiptState === 'loading'} />
      <BillingHistoryContent
        receipts={receipts}
        receiptState={receiptState}
        plans={plans}
        nextCursor={nextCursor}
        loadingMore={loadingMore}
        loadMoreError={loadMoreError}
        onRetry={onRetry}
        onLoadMore={onLoadMore}
      />
    </section>
  );
}

function BillingHistoryHeading({ historyId, loading }: { readonly historyId: string; readonly loading: boolean }) {
  return (
    <div className="career-billing-history-heading">
      <div>
        <p className="career-billing-eyebrow">Платежи</p>
        <h3 className="career-billing-title" id={historyId}>История платежей</h3>
      </div>
      {loading ? (
        <span className="career-billing-loading" role="status" aria-busy="true">
          <SpinnerGap className="career-billing-spinner career-billing-icon" aria-hidden="true" />
          Загружаем чеки
        </span>
      ) : null}
    </div>
  );
}

function BillingHistoryContent({
  receipts,
  receiptState,
  plans,
  nextCursor,
  loadingMore,
  loadMoreError,
  onRetry,
  onLoadMore,
}: {
  readonly receipts: readonly CandidateBillingReceipt[];
  readonly receiptState: 'loading' | 'ready' | 'error';
  readonly plans: CandidateBillingSummary['plans'];
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
  readonly loadMoreError: boolean;
  readonly onRetry: () => void;
  readonly onLoadMore: () => void;
}) {
  if (receiptState === 'loading') return null;
  if (receiptState === 'error') return <BillingHistoryError onRetry={onRetry} />;
  if (receipts.length === 0) {
    return (
      <p className="career-billing-history-state" role="status">
        Оплаченных платежей пока нет. Здесь появятся подтверждённые списания.
      </p>
    );
  }
  return (
    <BillingHistoryRows
      receipts={receipts}
      plans={plans}
      nextCursor={nextCursor}
      loadingMore={loadingMore}
      loadMoreError={loadMoreError}
      onLoadMore={onLoadMore}
    />
  );
}

function BillingHistoryError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div className="career-billing-history-state" role="alert">
      <p>Не удалось загрузить историю платежей.</p>
      <button className="career-btn career-btn-secondary" type="button" onClick={onRetry}>
        <ArrowClockwise className="career-billing-icon" aria-hidden="true" />
        Повторить
      </button>
    </div>
  );
}

function BillingHistoryRows({
  receipts,
  plans,
  nextCursor,
  loadingMore,
  loadMoreError,
  onLoadMore,
}: {
  readonly receipts: readonly CandidateBillingReceipt[];
  readonly plans: CandidateBillingSummary['plans'];
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
  readonly loadMoreError: boolean;
  readonly onLoadMore: () => void;
}) {
  return (
    <>
      <BillingReceiptTable receipts={receipts} plans={plans} />
      {nextCursor ? <LoadMoreReceiptsButton loading={loadingMore} onLoadMore={onLoadMore} /> : null}
      {loadMoreError ? (
        <p className="career-billing-error" role="alert">
          Не удалось загрузить предыдущие платежи. Попробуйте ещё раз.
        </p>
      ) : null}
    </>
  );
}

function LoadMoreReceiptsButton({ loading, onLoadMore }: { readonly loading: boolean; readonly onLoadMore: () => void }) {
  return (
    <button
      className="career-btn career-btn-secondary career-billing-load-more"
      type="button"
      aria-disabled={loading}
      aria-busy={loading}
      onClick={onLoadMore}
    >
      {loading ? (
        <>
          <SpinnerGap className="career-billing-spinner career-billing-icon" aria-hidden="true" />
          Загружаем платежи
        </>
      ) : 'Показать предыдущие платежи'}
    </button>
  );
}

function BillingReceiptTable({
  receipts,
  plans,
}: {
  readonly receipts: readonly CandidateBillingReceipt[];
  readonly plans: CandidateBillingSummary['plans'];
}) {
  return (
    <>
      <BillingDesktopReceiptTable receipts={receipts} plans={plans} />
      <BillingMobileReceiptCards receipts={receipts} plans={plans} />
    </>
  );
}

function BillingDesktopReceiptTable({
  receipts,
  plans,
}: {
  readonly receipts: readonly CandidateBillingReceipt[];
  readonly plans: CandidateBillingSummary['plans'];
}) {
  return (
    <div className="career-billing-table-wrap">
      <table className="career-billing-table" aria-label="Оплаченные тарифы и электронные чеки">
        <thead>
          <tr>
            <th scope="col">Дата</th>
            <th scope="col">Тариф</th>
            <th scope="col">Сумма</th>
            <th scope="col">Чек</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((receipt) => (
            <tr key={receipt.invoiceId}>
              <th scope="row">{formatDate(receipt.paidAt, true)}</th>
              <td>{planName(receipt.planId, plans)}</td>
              <td>{formatRubles(receipt.amountKopecks)}</td>
              <td><ReceiptValue receipt={receipt} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BillingMobileReceiptCards({
  receipts,
  plans,
}: {
  readonly receipts: readonly CandidateBillingReceipt[];
  readonly plans: CandidateBillingSummary['plans'];
}) {
  return (
    <ul className="career-billing-receipt-cards" aria-label="История оплаченных платежей">
      {receipts.map((receipt) => (
        <li className="career-billing-receipt-card" key={receipt.invoiceId}>
          <dl>
            <div className="career-billing-fact">
              <dt>Дата</dt>
              <dd>{formatDate(receipt.paidAt, true)}</dd>
            </div>
            <div className="career-billing-fact">
              <dt>Тариф</dt>
              <dd>{planName(receipt.planId, plans)}</dd>
            </div>
            <div className="career-billing-fact">
              <dt>Сумма</dt>
              <dd>{formatRubles(receipt.amountKopecks)}</dd>
            </div>
            <div className="career-billing-fact">
              <dt>Чек</dt>
              <dd><ReceiptValue receipt={receipt} /></dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function ReceiptValue({ receipt }: { readonly receipt: CandidateBillingReceipt }) {
  const href = safeReceiptUrl(receipt.receiptUrl);
  if (href) {
    return (
      <a className="career-billing-receipt-link" href={href} target="_blank" rel="noopener noreferrer">
        Открыть чек
      </a>
    );
  }
  return (
    <span>
      Ссылка на чек пока не получена
      {receipt.fiscalDocumentNumber ? (
        <small className="career-billing-fiscal-number">Фискальный документ №{receipt.fiscalDocumentNumber}</small>
      ) : (
        <small className="career-billing-fiscal-number">Номер фискального документа пока не получен</small>
      )}
    </span>
  );
}

function safeReceiptUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function planName(
  planId: CandidateBillingReceipt['planId'],
  plans: CandidateBillingSummary['plans'],
): string {
  return plans.find((plan) => plan.id === planId)?.name ?? planId;
}

function formatRubles(amountKopecks: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(amountKopecks / 100);
}

function formatDate(value: string | null, includeYear = false): string {
  if (!value) return 'Дата не указана';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Дата не указана';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: includeYear ? 'short' : 'long',
    ...(includeYear ? { year: 'numeric' as const } : {}),
  }).format(date);
}
