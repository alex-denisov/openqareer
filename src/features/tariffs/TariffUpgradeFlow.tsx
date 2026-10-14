import { useCallback, useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { CoachApiError, getSession } from '../coach/coachApi';
import {
  getCandidateBillingSummary,
  type CandidateBillingSummary,
} from '../shell/candidateBillingApi';
import { useEscapeLayer } from '../shell/escapeLayers';
import {
  createCandidateCheckout,
  createExecutiveSearchRequest,
  getCandidateCheckout,
  type CandidateCheckout,
  type CandidateExecutiveRequest,
  type PaidTariffPlanId,
} from './tariffUpgradeApi';
import { UpgradeDialog, type UpgradeDialogState } from './TariffUpgradeViews';

if (typeof document !== 'undefined') {
  void import('./tariff-upgrade.css');
}

export type TariffUpgradeContext =
  | { readonly kind: 'gate' }
  | { readonly kind: 'plan'; readonly planId: PaidTariffPlanId }
  | { readonly kind: 'plan-change-unavailable'; readonly planId: PaidTariffPlanId }
  | { readonly kind: 'payment-method'; readonly planId: PaidTariffPlanId }
  | {
      readonly kind: 'feature';
      readonly feature: 'resume' | 'interview' | 'applications';
      readonly detail?: string;
    }
  | { readonly kind: 'executive' };

export interface TariffUpgradeFlowProps {
  readonly context: TariffUpgradeContext;
  readonly summary?: CandidateBillingSummary | null;
  readonly onClose: () => void;
  readonly onNavigate?: () => void;
  readonly onSummaryChanged?: (summary: CandidateBillingSummary) => void;
}

export type FlowView =
  | 'offer'
  | 'checkout'
  | 'creating'
  | 'pending'
  | 'checking'
  | 'success'
  | 'failed'
  | 'error'
  | 'executive-form'
  | 'executive-sending'
  | 'executive-result'
  | 'executive-error';

export type AccountEmailState =
  | { readonly status: 'loading' }
  | { readonly status: 'verified'; readonly email: string }
  | { readonly status: 'unverified' }
  | { readonly status: 'error' };

export function TariffUpgradeFlow(props: TariffUpgradeFlowProps) {
  const titleId = useId();
  const [dialogElement, setDialogElement] = useState<HTMLDivElement | null>(null);
  const billing = useFlowBilling(props.summary, props.onSummaryChanged);
  const flow = useFlowScaffold(props.context);
  const accountEmail = useAccountEmail(flow.view);
  useEscapeLayer(props.onClose, true);
  const actionState = useUpgradeActions({ ...flow, billing, accountEmail });
  const state = composeDialogState(props, billing, flow, accountEmail, actionState);
  return (
    <UpgradeDialog
      titleId={titleId}
      dialogElement={dialogElement}
      setDialogElement={setDialogElement}
      state={state}
    />
  );
}

interface FlowScaffold {
  readonly view: FlowView;
  readonly selectedPlan: PaidTariffPlanId | null;
  readonly checkout: CandidateCheckout | null;
  readonly executiveRequest: CandidateExecutiveRequest | null;
  readonly task: string;
  readonly timeline: string;
  readonly profileConsent: boolean;
  readonly autoRenew: boolean;
  readonly checkoutKey: string | null;
  readonly requestKey: string | null;
  readonly message: string | null;
  readonly setView: (view: FlowView) => void;
  readonly setSelectedPlan: (planId: PaidTariffPlanId | null) => void;
  readonly setCheckout: (checkout: CandidateCheckout | null) => void;
  readonly setExecutiveRequest: (request: CandidateExecutiveRequest | null) => void;
  readonly setTask: (task: string) => void;
  readonly setTimeline: (timeline: string) => void;
  readonly setProfileConsent: (consent: boolean) => void;
  readonly setAutoRenew: (autoRenew: boolean) => void;
  readonly setCheckoutKey: (key: string | null) => void;
  readonly setRequestKey: (key: string | null) => void;
  readonly setMessage: (message: string | null) => void;
}

function useFlowScaffold(context: TariffUpgradeContext): FlowScaffold {
  const [view, setView] = useState<FlowView>(() => initialView(context));
  const [selectedPlan, setSelectedPlan] = useState<PaidTariffPlanId | null>(() =>
    planForContext(context),
  );
  const [checkout, setCheckout] = useState<CandidateCheckout | null>(null);
  const [executiveRequest, setExecutiveRequest] = useState<CandidateExecutiveRequest | null>(null);
  const [task, setTask] = useState('');
  const [timeline, setTimeline] = useState('');
  const [profileConsent, setProfileConsent] = useState(false);
  const [autoRenew, setAutoRenew] = useState(context.kind === 'payment-method');
  const [checkoutKey, setCheckoutKey] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(() =>
    context.kind === 'plan-change-unavailable'
      ? 'Понижение между платными тарифами со следующего периода пока недоступно. Текущий тариф не изменён.'
      : null,
  );
  return {
    view,
    selectedPlan,
    checkout,
    executiveRequest,
    task,
    timeline,
    profileConsent,
    autoRenew,
    checkoutKey,
    requestKey,
    message,
    setView,
    setSelectedPlan,
    setCheckout,
    setExecutiveRequest,
    setTask,
    setTimeline,
    setProfileConsent,
    setAutoRenew,
    setCheckoutKey,
    setRequestKey,
    setMessage,
  };
}

function composeDialogState(
  props: TariffUpgradeFlowProps,
  billing: BillingState,
  flow: FlowScaffold,
  accountEmail: AccountEmailState,
  actions: ReturnType<typeof useUpgradeActions>,
): UpgradeDialogState {
  return {
    context: props.context,
    summary: billing.summary,
    summaryStatus: billing.status,
    selectedPlan: flow.selectedPlan,
    view: flow.view,
    checkout: flow.checkout,
    executiveRequest: flow.executiveRequest,
    task: flow.task,
    timeline: flow.timeline,
    profileConsent: flow.profileConsent,
    autoRenew: flow.autoRenew,
    accountEmail,
    message: flow.message,
    onClose: props.onClose,
    onNavigate: props.onNavigate,
    onRetrySummary: billing.retry,
    onChoosePlan: (planId) => {
      flow.setSelectedPlan(planId);
      flow.setAutoRenew(false);
      flow.setView('checkout');
    },
    onBackToOffer: () => {
      flow.setMessage(null);
      flow.setView('offer');
    },
    onSetAutoRenew: flow.setAutoRenew,
    onStartCheckout: actions.startCheckout,
    onCheckStatus: actions.checkPaymentStatus,
    onRetryCheckout: actions.retryCheckout,
    onCloseError: () => closeFlowError(props.context, flow, props.onClose),
    onSetTask: flow.setTask,
    onSetTimeline: flow.setTimeline,
    onSetConsent: flow.setProfileConsent,
    onSubmitExecutive: actions.submitExecutive,
  };
}


function closeFlowError(
  context: TariffUpgradeContext,
  flow: FlowScaffold,
  onClose: () => void,
): void {
  if (context.kind === 'plan-change-unavailable') {
    onClose();
    return;
  }
  flow.setMessage(null);
  flow.setView(context.kind === 'executive' ? 'executive-form' : 'offer');
}

interface BillingState {
  readonly summary: CandidateBillingSummary | null;
  readonly status: 'loading' | 'ready' | 'error';
  readonly reload: () => Promise<CandidateBillingSummary>;
  readonly retry: () => void;
}

function useFlowBilling(
  initial: CandidateBillingSummary | null | undefined,
  onChanged?: (summary: CandidateBillingSummary) => void,
): BillingState {
  const [summary, setSummary] = useState<CandidateBillingSummary | null>(initial ?? null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    initial ? 'ready' : 'loading',
  );

  useEffect(() => {
    if (initial) {
      setSummary(initial);
      setStatus('ready');
      return;
    }
    let active = true;
    getCandidateBillingSummary()
      .then((next) => {
        if (!active) return;
        setSummary(next);
        setStatus('ready');
      })
      .catch(() => {
        if (active) setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [initial]);

  const reload = useCallback(async () => {
    const next = await getCandidateBillingSummary();
    setSummary(next);
    setStatus('ready');
    onChanged?.(next);
    return next;
  }, [onChanged]);
  const retry = useCallback(() => {
    setStatus('loading');
    void reload().catch(() => setStatus('error'));
  }, [reload]);

  return { summary, status, reload, retry };
}

interface UpgradeActionState {
  readonly accountEmail: AccountEmailState;
  readonly autoRenew: boolean;
  readonly billing: BillingState;
  readonly checkout: CandidateCheckout | null;
  readonly checkoutKey: string | null;
  readonly profileConsent: boolean;
  readonly requestKey: string | null;
  readonly selectedPlan: PaidTariffPlanId | null;
  readonly task: string;
  readonly timeline: string;
  readonly setCheckout: (checkout: CandidateCheckout | null) => void;
  readonly setCheckoutKey: (key: string | null) => void;
  readonly setExecutiveRequest: (request: CandidateExecutiveRequest | null) => void;
  readonly setMessage: (message: string | null) => void;
  readonly setRequestKey: (key: string | null) => void;
  readonly setView: (view: FlowView) => void;
}

function useUpgradeActions(state: UpgradeActionState) {
  const startCheckout = useCallback(() => startCandidateCheckout(state), [state]);
  const checkPaymentStatus = useCallback(() => checkCandidateCheckout(state), [state]);
  const retryCheckout = useCallback(() => {
    state.setCheckout(null);
    state.setCheckoutKey(null);
    state.setMessage(null);
    state.setView('checkout');
  }, [state]);
  const submitExecutive = useCallback(
    (event: FormEvent<HTMLFormElement>) => submitExecutiveRequest(event, state),
    [state],
  );
  return { startCheckout, checkPaymentStatus, retryCheckout, submitExecutive };
}

async function startCandidateCheckout(state: UpgradeActionState): Promise<void> {
  if (!state.selectedPlan || state.accountEmail.status !== 'verified') return;
  const key = state.checkoutKey ?? secureId();
  if (!key) {
    state.setMessage(
      'Не удалось подготовить безопасный ключ заказа. Обновите страницу и повторите.',
    );
    state.setView('error');
    return;
  }
  state.setCheckoutKey(key);
  state.setMessage(null);
  state.setView('creating');
  try {
    const created = await createCandidateCheckout({
      planId: state.selectedPlan,
      autoRenew: state.autoRenew,
      idempotencyKey: key,
    });
    state.setCheckout(created);
    if (created.status === 'failed') {
      state.setView('failed');
      return;
    }
    if (created.status === 'paid') {
      await confirmPaidCheckout(created, state);
      return;
    }
    state.setView('pending');
  } catch (error) {
    state.setMessage(apiMessage(error));
    state.setView(errorCode(error) === 'billing_payment_processing' ? 'pending' : 'error');
  }
}

async function checkCandidateCheckout(state: UpgradeActionState): Promise<void> {
  if (!state.checkout) return;
  state.setMessage(null);
  state.setView('checking');
  try {
    const current = await getCandidateCheckout(state.checkout.invoiceId);
    state.setCheckout(current);
    if (current.status === 'paid') {
      await confirmPaidCheckout(current, state);
    } else {
      state.setView(current.status === 'failed' ? 'failed' : 'pending');
    }
  } catch (error) {
    state.setMessage(apiMessage(error));
    state.setView('pending');
  }
}

async function confirmPaidCheckout(
  checkout: CandidateCheckout,
  state: UpgradeActionState,
): Promise<void> {
  try {
    const summary = await state.billing.reload();
    if (summary.currentPlan === checkout.planId && summary.subscription?.status === 'active') {
      state.setMessage(null);
      state.setView('success');
      return;
    }
    state.setMessage('Оплата подтверждена, тариф ещё обновляется. Проверьте статус ещё раз.');
    state.setView('pending');
  } catch {
    state.setMessage('Оплата подтверждена; не удалось обновить тариф. Проверьте статус ещё раз.');
    state.setView('pending');
  }
}

async function submitExecutiveRequest(
  event: FormEvent<HTMLFormElement>,
  state: UpgradeActionState,
): Promise<void> {
  event.preventDefault();
  if (!isExecutiveFormReady(state.task, state.timeline, state.profileConsent)) return;
  const key = state.requestKey ?? secureId();
  if (!key) {
    state.setMessage(
      'Не удалось подготовить безопасный ключ заявки. Обновите страницу и повторите.',
    );
    state.setView('executive-error');
    return;
  }
  state.setRequestKey(key);
  state.setMessage(null);
  state.setView('executive-sending');
  try {
    const request = await createExecutiveSearchRequest({
      task: state.task.trim(),
      timeline: state.timeline.trim(),
      profileSharingConsent: true,
      idempotencyKey: key,
    });
    state.setExecutiveRequest(request);
    state.setView('executive-result');
  } catch (error) {
    state.setMessage(apiMessage(error));
    state.setView('executive-error');
  }
}

function useAccountEmail(view: FlowView): AccountEmailState {
  const [state, setState] = useState<AccountEmailState>({ status: 'loading' });
  useEffect(() => {
    if (view !== 'checkout') return;
    let active = true;
    getSession()
      .then((user) => {
        if (!active) return;
        setState(
          user?.emailVerified && user.email
            ? { status: 'verified', email: user.email }
            : { status: 'unverified' },
        );
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [view]);
  return state;
}

function initialView(context: TariffUpgradeContext): FlowView {
  if (context.kind === 'executive') return 'executive-form';
  if (context.kind === 'plan-change-unavailable') return 'error';
  return context.kind === 'payment-method' ? 'checkout' : 'offer';
}

function planForContext(context: TariffUpgradeContext): PaidTariffPlanId | null {
  if (context.kind === 'plan' || context.kind === 'payment-method') return context.planId;
  if (context.kind === 'feature') return context.feature === 'applications' ? 'pro' : 'basic';
  return null;
}

function secureId(): string | null {
  try {
    return globalThis.crypto?.randomUUID?.() ?? null;
  } catch {
    return null;
  }
}

function isExecutiveFormReady(task: string, timeline: string, consent: boolean): boolean {
  return (
    task.trim().length >= 10 &&
    task.trim().length <= 1000 &&
    timeline.trim().length >= 2 &&
    timeline.trim().length <= 160 &&
    consent
  );
}

function apiMessage(error: unknown): string {
  if (error instanceof CoachApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Не удалось выполнить запрос. Проверьте соединение и повторите.';
}

function errorCode(error: unknown): string | null {
  return error instanceof CoachApiError ? error.code : null;
}
