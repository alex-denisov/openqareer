import { useState } from 'react';
import { ArrowClockwise } from '@phosphor-icons/react';
import { CareerTariffsView, type TariffTierId } from '../tariffs';
import { BillingManagementPanel } from '../tariffs/BillingManagementPanel';
import { cancelCandidateBillingRenewal, type CandidateCurrentPlanId } from './candidateBillingApi';
import { useCandidateBillingReceipts, useCandidateBillingSummary } from './candidateBillingHooks';

type CancellationState = 'idle' | 'pending' | 'done' | 'error';

export function TariffsScreen() {
  const billing = useCandidateBillingSummary();
  const receipts = useCandidateBillingReceipts();
  const [cancellationState, setCancellationState] = useState<CancellationState>('idle');

  const cancelRenewal = async () => {
    if (cancellationState === 'pending') return;
    setCancellationState('pending');
    try {
      const cancellation = await cancelCandidateBillingRenewal();
      billing.applyCancellation(cancellation);
      setCancellationState('done');
    } catch {
      setCancellationState('error');
    }
  };

  if (billing.state === 'loading') {
    return <BillingLoadingState />;
  }

  if (billing.state === 'error' || !billing.summary) {
    return <BillingErrorState onRetry={billing.retry} />;
  }

  const summary = billing.summary;
  const panel = (
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
  );

  return (
    <CareerTariffsView
      activeTierId={tariffTierFor(summary.currentPlan)}
      billingSummary={summary}
      billingPanel={panel}
      onSummaryChanged={billing.applySummary}
    />
  );
}

function BillingLoadingState() {
  return (
    <div className="career-tariffs career-billing-page-state" role="status" aria-busy="true">
      <p>Загружаем ваш тариф и историю платежей.</p>
    </div>
  );
}

function BillingErrorState({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <section
      className="career-tariffs career-billing-page-state"
      aria-labelledby="billing-load-error"
    >
      <h2 id="billing-load-error">Не удалось загрузить тариф</h2>
      <p role="alert">Проверьте соединение и повторите попытку.</p>
      <button className="career-btn career-btn-secondary" type="button" onClick={onRetry}>
        <ArrowClockwise className="career-billing-icon" aria-hidden="true" />
        Повторить
      </button>
    </section>
  );
}

function tariffTierFor(plan: CandidateCurrentPlanId): TariffTierId {
  if (plan === 'basic') return 'go';
  return plan;
}
