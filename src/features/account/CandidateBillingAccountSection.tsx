import { useState } from 'react';
import { ArrowClockwise, TrendUp } from '@phosphor-icons/react';
import { BillingManagementPanel } from '../tariffs/BillingManagementPanel';
import {
  cancelCandidateBillingRenewal,
  type CandidateBillingCancellation,
  type CandidateBillingSummary,
} from '../shell/candidateBillingApi';
import { useCandidateBillingReceipts, useCandidateBillingSummary } from '../shell/candidateBillingHooks';

type CancellationState = 'idle' | 'pending' | 'done' | 'error';

export function CandidateBillingAccountSection({
  onOpenTariffs,
}: {
  readonly onOpenTariffs?: () => void;
}) {
  const billing = useCandidateBillingSummary();
  const receipts = useCandidateBillingReceipts();

  if (billing.state === 'loading') return <BillingLoadingState />;
  if (billing.state === 'error' || !billing.summary) {
    return <BillingErrorState onRetry={billing.retry} />;
  }

  return (
    <BillingReadyState
      summary={billing.summary}
      applyCancellation={billing.applyCancellation}
      receipts={receipts}
      onOpenTariffs={onOpenTariffs}
    />
  );
}

function BillingLoadingState() {
  return (
    <div className="career-account-card" role="status" aria-busy="true">
      <p>Загружаем ваш тариф и историю платежей.</p>
    </div>
  );
}

function BillingErrorState({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <section className="career-account-card" aria-labelledby="account-billing-error">
      <h3 id="account-billing-error">Не удалось загрузить тариф</h3>
      <p role="alert">Проверьте соединение и повторите попытку.</p>
      <button className="career-btn is-sm" type="button" onClick={onRetry}>
        <ArrowClockwise size={16} aria-hidden="true" />
        Повторить
      </button>
    </section>
  );
}

function BillingReadyState({
  summary,
  applyCancellation,
  receipts,
  onOpenTariffs,
}: {
  readonly summary: CandidateBillingSummary;
  readonly applyCancellation: (cancellation: CandidateBillingCancellation) => void;
  readonly receipts: ReturnType<typeof useCandidateBillingReceipts>;
  readonly onOpenTariffs?: () => void;
}) {
  const [cancellationState, setCancellationState] = useState<CancellationState>('idle');

  const cancelRenewal = async () => {
    if (cancellationState === 'pending') return;
    setCancellationState('pending');
    try {
      applyCancellation(await cancelCandidateBillingRenewal());
      setCancellationState('done');
    } catch {
      setCancellationState('error');
    }
  };

  return (
    <div className="career-account-billing">
      {onOpenTariffs ? <BillingTariffAction currentPlan={summary.currentPlan} onOpen={onOpenTariffs} /> : null}
      <BillingManagementPanel
        summary={summary}
        receipts={receipts.receipts}
        receiptState={receipts.state}
        nextCursor={receipts.nextCursor}
        loadingMore={receipts.loadingMore}
        loadMoreError={receipts.loadMoreError}
        cancellationState={cancellationState}
        onCancelRenewal={cancelRenewal}
        onRetryReceipts={receipts.retry}
        onLoadMore={receipts.loadMore}
      />
    </div>
  );
}

function BillingTariffAction({
  currentPlan,
  onOpen,
}: {
  readonly currentPlan: CandidateBillingSummary['currentPlan'];
  readonly onOpen: () => void;
}) {
  return (
    <div className="career-account-rows">
      <button className="career-btn is-sm" type="button" onClick={onOpen}>
        <TrendUp size={16} aria-hidden="true" />
        {currentPlan === 'free' ? 'Выбрать тариф' : 'Сменить тариф'}
      </button>
    </div>
  );
}
