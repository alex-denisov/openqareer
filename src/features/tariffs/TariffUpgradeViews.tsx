import { useEffect } from 'react';
import {
  ArrowClockwise,
  ArrowSquareOut,
  CaretLeft,
  Check,
  CheckCircle,
  Clock,
  Info,
  SpinnerGap,
  TrendUp,
  X,
} from '@phosphor-icons/react';
import type { FormEvent } from 'react';
import type {
  CandidateBillingPlan,
  CandidateBillingSummary,
  CandidateCurrentPlanId,
} from '../shell/candidateBillingApi';
import type {
  CandidateCheckout,
  CandidateExecutiveRequest,
  PaidTariffPlanId,
} from './tariffUpgradeApi';
import type { AccountEmailState, FlowView, TariffUpgradeContext } from './TariffUpgradeFlow';

export interface UpgradeDialogState {
  readonly context: TariffUpgradeContext;
  readonly summary: CandidateBillingSummary | null;
  readonly summaryStatus: 'loading' | 'ready' | 'error';
  readonly selectedPlan: PaidTariffPlanId | null;
  readonly view: FlowView;
  readonly checkout: CandidateCheckout | null;
  readonly executiveRequest: CandidateExecutiveRequest | null;
  readonly task: string;
  readonly timeline: string;
  readonly profileConsent: boolean;
  readonly autoRenew: boolean;
  readonly accountEmail: AccountEmailState;
  readonly message: string | null;
  readonly onClose: () => void;
  readonly onNavigate?: () => void;
  readonly onRetrySummary: () => void;
  readonly onChoosePlan: (planId: PaidTariffPlanId) => void;
  readonly onBackToOffer: () => void;
  readonly onSetAutoRenew: (value: boolean) => void;
  readonly onStartCheckout: () => void;
  readonly onCheckStatus: () => void;
  readonly onSetTask: (value: string) => void;
  readonly onSetTimeline: (value: string) => void;
  readonly onSetConsent: (value: boolean) => void;
  readonly onSubmitExecutive: (event: FormEvent<HTMLFormElement>) => void;
  readonly onRetryCheckout: () => void;
  readonly onCloseError: () => void;
}

export function UpgradeDialog({
  titleId,
  dialogElement,
  setDialogElement,
  state,
}: {
  readonly titleId: string;
  readonly dialogElement: HTMLDivElement | null;
  readonly setDialogElement: (element: HTMLDivElement | null) => void;
  readonly state: UpgradeDialogState;
}) {
  const fullPage = state.view !== 'offer';
  useDialogFocus(dialogElement);
  return (
    <div
      className={'career-upgrade-backdrop' + (fullPage ? ' is-flow-page' : '')}
      data-testid="tariff-upgrade-flow"
    >
      <div
        className={'career-paywall-modal career-upgrade-modal' + (fullPage ? ' is-flow-page' : '')}
        role="dialog"
        data-testid="career-paywall-modal"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={setDialogElement}
        tabIndex={-1}
      >
        <FlowHeader titleId={titleId} state={state} />
        <FlowContent state={state} />
      </div>
    </div>
  );
}

function FlowHeader({
  titleId,
  state,
}: {
  readonly titleId: string;
  readonly state: UpgradeDialogState;
}) {
  const title = titleForUpgradeFlow(state);
  const showBack =
    state.view !== 'offer' && state.view !== 'executive-form' && state.view !== 'executive-sending';
  const onBack = state.view.startsWith('executive') ? state.onCloseError : state.onBackToOffer;
  return (
    <div className="career-upgrade-header">
      {showBack ? (
        <button className="career-upgrade-back" type="button" onClick={onBack} aria-label="Назад">
          <CaretLeft size={20} aria-hidden="true" />
        </button>
      ) : null}
      <h2 id={titleId} className="career-paywall-title">
        {title}
      </h2>
      <button
        className="career-paywall-close-btn"
        type="button"
        onClick={state.onClose}
        aria-label="Закрыть оплату"
      >
        <X size={20} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}

function useDialogFocus(dialog: HTMLDivElement | null): void {
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector = 'button:not(:disabled),input:not(:disabled),a[href],textarea:not(:disabled)';
    (dialog?.querySelector<HTMLElement>(selector) ?? dialog)?.focus();
    const trap = (event: KeyboardEvent) => trapDialogTab(event, dialog, selector);
    window.addEventListener('keydown', trap);
    return () => {
      window.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, [dialog]);
}

function trapDialogTab(
  event: KeyboardEvent,
  dialog: HTMLDivElement | null,
  selector: string,
): void {
  if (event.key !== 'Tab' || !dialog) return;
  const items = [...dialog.querySelectorAll<HTMLElement>(selector)];
  if (items.length === 0) return;
  if (event.shiftKey && document.activeElement === items[0]) {
    event.preventDefault();
    items.at(-1)?.focus();
  } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
    event.preventDefault();
    items[0]?.focus();
  }
}

function FlowContent({ state }: { readonly state: UpgradeDialogState }) {
  if (state.summaryStatus === 'loading') return <FlowLoading message="Загружаем данные тарифа." />;
  if (state.summaryStatus === 'error' || !state.summary) {
    return <FlowSummaryError onRetry={state.onRetrySummary} onClose={state.onClose} />;
  }
  if (state.view === 'offer') return <OfferView state={state} summary={state.summary} />;
  if (state.view === 'checkout' || state.view === 'creating') {
    return <CheckoutView state={state} summary={state.summary} />;
  }
  if (state.view === 'pending' || state.view === 'checking') return <PendingView state={state} />;
  if (state.view === 'success') return <SuccessView state={state} summary={state.summary} />;
  if (state.view === 'failed') return <FailedView state={state} />;
  if (
    state.view === 'executive-form' ||
    state.view === 'executive-sending' ||
    state.view === 'executive-error'
  ) {
    return <ExecutiveFormView state={state} />;
  }
  if (state.view === 'executive-result') return <ExecutiveResultView state={state} />;
  return <FlowErrorView state={state} />;
}

function OfferView({
  state,
  summary,
}: {
  readonly state: UpgradeDialogState;
  readonly summary: CandidateBillingSummary;
}) {
  const plans = planOptions(state.context, summary.currentPlan);
  if (plans.length === 0) return <AlreadyOnPlanView state={state} summary={summary} />;
  return (
    <div className="career-upgrade-offer" data-testid="tariff-offer">
      <OfferContextCopy context={state.context} />
      <OfferBenefits plan={findPlan(summary, plans[0])} context={state.context} />
      <div className="career-upgrade-actions">
        {plans.map((planId, index) => (
          <OfferPlanButton
            key={planId}
            plan={findPlan(summary, planId)}
            featured={index === 0}
            onChoose={() => state.onChoosePlan(planId)}
          />
        ))}
        {state.onNavigate ? (
          <button className="career-btn is-secondary" type="button" onClick={state.onNavigate}>
            Сравнить тарифы
          </button>
        ) : null}
        <button className="career-btn is-ghost" type="button" onClick={state.onClose}>
          Не сейчас
        </button>
      </div>
    </div>
  );
}

function OfferContextCopy({ context }: { readonly context: TariffUpgradeContext }) {
  if (context.kind === 'feature')
    return <p className="career-upgrade-intro">{context.detail ?? featureCopy(context.feature)}</p>;
  if (context.kind === 'gate') {
    return (
      <p className="career-upgrade-intro">
        Для этого действия нужен платный тариф. Профиль, роли и подборка вакансий остаются доступны.
      </p>
    );
  }
  if (context.kind === 'plan')
    return (
      <p className="career-upgrade-intro">
        Выберите тариф для этого действия. Результат поиска не гарантируется.
      </p>
    );
  return (
    <p className="career-upgrade-intro">
      Executive — заявка на разовую услугу. Оплаты в приложении нет.
    </p>
  );
}

function OfferBenefits({
  plan,
  context,
}: {
  readonly plan: CandidateBillingPlan | null;
  readonly context: TariffUpgradeContext;
}) {
  return (
    <div className="career-upgrade-benefits">
      <section>
        <h3>Что сделаем сейчас</h3>
        <ul>
          <li>
            <Check size={16} aria-hidden="true" />
            <span>{featureBenefit(context, plan)}</span>
          </li>
        </ul>
      </section>
      <section>
        <h3>Что остаётся бесплатным</h3>
        <ul className="is-free">
          <li>
            <span aria-hidden="true">—</span>
            <span>Профиль, роли и подборка вакансий.</span>
          </li>
          <li>
            <span aria-hidden="true">—</span>
            <span>История профиля и подтверждённые факты.</span>
          </li>
        </ul>
      </section>
      <p className="career-upgrade-note">
        <Info size={16} aria-hidden="true" />
        <span>Доступ включится только после подтверждения платежа сервером.</span>
      </p>
    </div>
  );
}

function featureBenefit(context: TariffUpgradeContext, plan: CandidateBillingPlan | null): string {
  if (context.kind === 'feature') {
    const description = context.detail ?? featureCopy(context.feature);
    return description + ' — тариф ' + (plan?.name ?? 'по выбору') + '.';
  }
  if (context.kind === 'plan') return 'Доступ к тарифу ' + (plan?.name ?? '') + ' на один месяц.';
  return 'Выбранный тариф включится только после подтверждения оплаты сервером.';
}

function OfferPlanButton({
  plan,
  featured,
  onChoose,
}: {
  readonly plan: CandidateBillingPlan | null;
  readonly featured: boolean;
  readonly onChoose: () => void;
}) {
  if (!plan) return null;
  return (
    <button
      className={'career-btn ' + (featured ? 'is-primary' : 'is-secondary')}
      type="button"
      onClick={onChoose}
    >
      <TrendUp size={16} aria-hidden="true" />
      Перейти на {plan.name}, {formatRubles(plan.amountKopecks)}
    </button>
  );
}

function AlreadyOnPlanView({
  state,
  summary,
}: {
  readonly state: UpgradeDialogState;
  readonly summary: CandidateBillingSummary;
}) {
  const plan = summary.plans.find((item) => item.id === summary.currentPlan);
  return (
    <div className="career-upgrade-state" data-testid="already-on-plan" role="status">
      <CheckCircle size={24} aria-hidden="true" />
      <p>{plan?.name ?? 'Ваш тариф'} уже подключён.</p>
      {summary.subscription?.currentPeriodEndsAt ? (
        <p>Доступ действует до {formatDate(summary.subscription.currentPeriodEndsAt)}.</p>
      ) : null}
      <button className="career-btn is-secondary" type="button" onClick={state.onClose}>
        К тарифам
      </button>
    </div>
  );
}

function CheckoutView({
  state,
  summary,
}: {
  readonly state: UpgradeDialogState;
  readonly summary: CandidateBillingSummary;
}) {
  const plan = findPlan(summary, state.selectedPlan);
  const canPay =
    state.view === 'checkout' && Boolean(plan) && state.accountEmail.status === 'verified';
  return (
    <div className="career-upgrade-payment" data-testid="tariff-checkout">
      <section className="career-upgrade-card">
        <h3>Как оплатить</h3>
        <p className="career-upgrade-note">
          <Info size={16} aria-hidden="true" />
          <span>Способ оплаты и данные карты вводятся только на странице Robokassa.</span>
        </p>
        <ReceiptDestination email={state.accountEmail} />
        <RenewalConsent plan={plan} checked={state.autoRenew} onChange={state.onSetAutoRenew} />
        {state.view === 'creating' ? <FlowLoading message="Создаём заказ." /> : null}
        {state.message ? (
          <p className="career-upgrade-error" role="alert">
            {state.message}
          </p>
        ) : null}
        <div className="career-upgrade-actions">
          <button
            className="career-btn is-primary"
            type="button"
            disabled={!canPay}
            onClick={state.onStartCheckout}
          >
            {plan ? 'Перейти к оплате, ' + formatRubles(plan.amountKopecks) : 'Тариф не загружен'}
          </button>
          <button className="career-btn is-ghost" type="button" onClick={state.onClose}>
            Назад к тарифам
          </button>
        </div>
      </section>
      <OrderSummary plan={plan} autoRenew={state.autoRenew} />
    </div>
  );
}

function ReceiptDestination({ email }: { readonly email: AccountEmailState }) {
  if (email.status === 'loading')
    return (
      <p className="career-upgrade-receipt" role="status">
        Проверяем адрес для чека.
      </p>
    );
  if (email.status === 'verified')
    return (
      <p className="career-upgrade-receipt">
        Чек по 54-ФЗ: {email.email}. Платёжный сервис отправит его после оплаты.
      </p>
    );
  return (
    <p className="career-upgrade-error" role="alert">
      Подтвердите email в аккаунте, чтобы получить чек 54-ФЗ.
    </p>
  );
}

function RenewalConsent({
  plan,
  checked,
  onChange,
}: {
  readonly plan: CandidateBillingPlan | null;
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  if (!plan) return null;
  return (
    <label className="career-checkbox-label career-upgrade-consent">
      <input
        className="career-checkbox"
        type="checkbox"
        name="auto-renew"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="career-checkbox-text">
        Включить автопродление: {formatRubles(plan.amountKopecks)} ежемесячно. Отменить можно в
        аккаунте в один клик.
      </span>
    </label>
  );
}

function OrderSummary({
  plan,
  autoRenew,
}: {
  readonly plan: CandidateBillingPlan | null;
  readonly autoRenew: boolean;
}) {
  if (!plan) return null;
  return (
    <aside className="career-upgrade-order" aria-label="Ваш заказ">
      <h3>Ваш заказ</h3>
      <p>
        <strong>{plan.name}, 1 месяц</strong>
      </p>
      <p>
        {formatRubles(plan.amountKopecks)}
        {autoRenew ? ', автопродление' : ', без автопродления'}
      </p>
      <p>Доступ сохраняется до конца оплаченного периода после отмены.</p>
      <p>Результат поиска не гарантируется.</p>
    </aside>
  );
}

function PendingView({ state }: { readonly state: UpgradeDialogState }) {
  const paymentUrl = safeRobokassaUrl(state.checkout?.paymentUrl ?? null);
  const title =
    state.checkout?.status === 'processing'
      ? 'Платёж принят, ждём подтверждения банка.'
      : 'Заказ создан. Тариф включится после подтверждения оплаты.';
  return (
    <div className="career-upgrade-state" data-testid="tariff-payment-pending">
      <Clock size={24} aria-hidden="true" />
      <p role="status" aria-live="polite">
        {state.message ?? title}
      </p>
      {paymentUrl ? (
        <a
          className="career-btn is-primary"
          href={paymentUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ArrowSquareOut size={16} aria-hidden="true" />
          Открыть страницу Robokassa
        </a>
      ) : null}
      {state.checkout ? (
        <button
          className="career-btn is-secondary"
          type="button"
          disabled={state.view === 'checking'}
          onClick={state.onCheckStatus}
        >
          {state.view === 'checking' ? (
            <SpinnerGap className="career-upgrade-spinner" aria-hidden="true" />
          ) : (
            <ArrowClockwise size={16} aria-hidden="true" />
          )}
          Проверить статус
        </button>
      ) : null}
      <button className="career-btn is-ghost" type="button" onClick={state.onClose}>
        Вернуться без оплаты
      </button>
    </div>
  );
}

function SuccessView({
  state,
  summary,
}: {
  readonly state: UpgradeDialogState;
  readonly summary: CandidateBillingSummary;
}) {
  const planName = findPlan(summary, state.checkout?.planId ?? null)?.name ?? 'Тариф';
  const periodEnd = summary.subscription?.currentPeriodEndsAt;
  return (
    <div
      className="career-upgrade-state is-success"
      data-testid="tariff-payment-success"
      role="status"
    >
      <CheckCircle size={24} aria-hidden="true" />
      <h3>{planName} подключён</h3>
      <p>
        {periodEnd
          ? 'Доступ действует до ' + formatDate(periodEnd) + '.'
          : 'Оплата подтверждена сервером.'}
      </p>
      <p>
        Чек по 54-ФЗ передан платёжному сервису; ссылка появится в истории после получения от
        провайдера.
      </p>
      <button className="career-btn is-primary" type="button" onClick={state.onClose}>
        К тарифам
      </button>
    </div>
  );
}

function FailedView({ state }: { readonly state: UpgradeDialogState }) {
  const retryLabel =
    state.context.kind === 'payment-method' ? 'Обновить способ оплаты' : 'Повторить оплату';
  return (
    <div className="career-upgrade-state is-error" data-testid="tariff-payment-failed" role="alert">
      <p>Оплата не прошла. Тариф не изменён.</p>
      <div className="career-upgrade-actions">
        <button className="career-btn is-primary" type="button" onClick={state.onRetryCheckout}>
          {retryLabel}
        </button>
        <button className="career-btn is-secondary" type="button" onClick={state.onClose}>
          К тарифам
        </button>
      </div>
    </div>
  );
}

function ExecutiveFormView({ state }: { readonly state: UpgradeDialogState }) {
  return (
    <form
      className="career-upgrade-executive"
      onSubmit={state.onSubmitExecutive}
      data-testid="executive-request-form"
    >
      <ExecutiveFormIntro />
      <ExecutiveTaskField state={state} />
      <ExecutiveTimelineField state={state} />
      <ExecutiveConsent state={state} />
      <ExecutiveFormFeedback state={state} />
      <ExecutiveSubmitButton state={state} />
    </form>
  );
}

function ExecutiveFormIntro() {
  return (
    <p className="career-upgrade-intro">
      Executive — заявка на разовую услугу. Оплаты в приложении нет; статус зависит от ответа
      сервера.
    </p>
  );
}

function ExecutiveTaskField({ state }: { readonly state: UpgradeDialogState }) {
  return (
    <label className="career-upgrade-field">
      <span>Расскажите о задаче</span>
      <textarea
        name="task"
        required
        minLength={10}
        maxLength={1000}
        value={state.task}
        onChange={(event) => state.onSetTask(event.currentTarget.value)}
      />
    </label>
  );
}

function ExecutiveTimelineField({ state }: { readonly state: UpgradeDialogState }) {
  return (
    <label className="career-upgrade-field">
      <span>Цель и сроки</span>
      <input
        name="timeline"
        required
        minLength={2}
        maxLength={160}
        value={state.timeline}
        onChange={(event) => state.onSetTimeline(event.currentTarget.value)}
      />
    </label>
  );
}

function ExecutiveConsent({ state }: { readonly state: UpgradeDialogState }) {
  return (
    <label className="career-checkbox-label career-upgrade-consent">
      <input
        className="career-checkbox"
        type="checkbox"
        name="profile-consent"
        checked={state.profileConsent}
        onChange={(event) => state.onSetConsent(event.currentTarget.checked)}
      />
      <span className="career-checkbox-text">
        Разрешаю команде видеть мой профиль и цель для оценки заявки.
      </span>
    </label>
  );
}

function ExecutiveFormFeedback({ state }: { readonly state: UpgradeDialogState }) {
  return (
    <>
      <p className="career-upgrade-note">
        <Info size={16} aria-hidden="true" />
        <span>Оплата не списывается при отправке заявки.</span>
      </p>
      {state.message ? (
        <p className="career-upgrade-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </>
  );
}

function ExecutiveSubmitButton({ state }: { readonly state: UpgradeDialogState }) {
  const busy = state.view === 'executive-sending';
  const valid =
    state.task.trim().length >= 10 &&
    state.task.trim().length <= 1000 &&
    state.timeline.trim().length >= 2 &&
    state.timeline.trim().length <= 160 &&
    state.profileConsent;
  return (
    <button
      className="career-btn is-primary"
      type="submit"
      disabled={!valid || busy}
      aria-busy={busy}
    >
      {busy ? <SpinnerGap className="career-upgrade-spinner" aria-hidden="true" /> : null}
      Отправить заявку
    </button>
  );
}

function ExecutiveResultView({ state }: { readonly state: UpgradeDialogState }) {
  const waitlisted = state.executiveRequest?.status === 'waitlisted';
  return (
    <div className="career-upgrade-state" data-testid="executive-request-result" role="status">
      <CheckCircle size={24} aria-hidden="true" />
      <h3>{waitlisted ? 'Вы в списке ожидания' : 'Заявка отправлена'}</h3>
      <p>
        {waitlisted
          ? 'Мест сейчас нет. Заявка сохранена. Оплата не списывалась.'
          : 'Заявка сохранена. Оплата не списывалась.'}
      </p>
      <button className="career-btn is-primary" type="button" onClick={state.onClose}>
        К тарифам
      </button>
    </div>
  );
}

function FlowErrorView({ state }: { readonly state: UpgradeDialogState }) {
  return (
    <div className="career-upgrade-state is-error" data-testid="tariff-upgrade-error" role="alert">
      <p>{state.message ?? 'Не удалось выполнить запрос.'}</p>
      <div className="career-upgrade-actions">
        {state.selectedPlan ? (
          <button className="career-btn is-primary" type="button" onClick={state.onRetryCheckout}>
            Повторить
          </button>
        ) : null}
        <button className="career-btn is-secondary" type="button" onClick={state.onCloseError}>
          К тарифам
        </button>
      </div>
    </div>
  );
}

function FlowLoading({ message }: { readonly message: string }) {
  return (
    <p className="career-upgrade-loading" role="status" aria-busy="true">
      <SpinnerGap className="career-upgrade-spinner" aria-hidden="true" />
      {message}
    </p>
  );
}

function FlowSummaryError({
  onRetry,
  onClose,
}: {
  readonly onRetry: () => void;
  readonly onClose: () => void;
}) {
  return (
    <div className="career-upgrade-state" role="alert">
      <p>Не удалось проверить текущий тариф. Оплата не начата.</p>
      <div className="career-upgrade-actions">
        <button className="career-btn is-secondary" type="button" onClick={onRetry}>
          Повторить
        </button>
        <button className="career-btn is-ghost" type="button" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}

export function titleForUpgradeFlow(state: UpgradeDialogState): string {
  if (state.view.startsWith('executive')) return 'Заявка: поиск под ключ';
  if (state.view === 'pending' || state.view === 'checking') return 'Ждём подтверждения банка';
  if (state.view === 'success')
    return (
      (findPlan(state.summary, state.checkout?.planId ?? null)?.name ?? 'Тариф') + ' подключён'
    );
  if (state.view === 'failed') return 'Оплата не прошла';
  if (state.context.kind === 'payment-method') return 'Обновить способ оплаты';
  if (state.view === 'checkout' || state.view === 'creating')
    return 'Оплата тарифа ' + (findPlan(state.summary, state.selectedPlan)?.name ?? '');
  if (state.view === 'error') return 'Оплата недоступна';
  if (state.context.kind === 'feature')
    return state.context.detail ?? featureCopy(state.context.feature);
  if (state.context.kind === 'plan')
    return 'Переход на тариф ' + (findPlan(state.summary, state.context.planId)?.name ?? '');
  if (state.context.kind === 'executive') return 'Заявка: поиск под ключ';
  return 'Переход на тариф';
}

function featureCopy(feature: 'resume' | 'interview' | 'applications'): string {
  const labels = {
    resume: 'Резюме под вакансию: тариф Basic',
    interview: 'Мок-интервью: тариф Basic',
    applications: 'Отправка откликов платформой: тариф Pro',
  };
  return labels[feature];
}

function planOptions(
  context: TariffUpgradeContext,
  current: CandidateCurrentPlanId,
): PaidTariffPlanId[] {
  const plans: readonly PaidTariffPlanId[] =
    context.kind === 'gate'
      ? ['basic', 'pro']
      : context.kind === 'plan'
        ? [context.planId]
        : context.kind === 'payment-method'
          ? [context.planId]
          : context.kind === 'feature'
            ? [context.feature === 'applications' ? 'pro' : 'basic']
            : [];
  return plans.filter((plan) => !isCurrentOrHigher(current, plan));
}

function isCurrentOrHigher(current: CandidateCurrentPlanId, target: PaidTariffPlanId): boolean {
  const rank: Record<CandidateCurrentPlanId, number> = { free: 0, basic: 1, pro: 2, max: 3 };
  return rank[current] >= rank[target];
}

function findPlan(
  summary: CandidateBillingSummary | null,
  id: PaidTariffPlanId | null,
): CandidateBillingPlan | null {
  return id ? (summary?.plans.find((plan) => plan.id === id) ?? null) : null;
}

function formatRubles(amountKopecks: number): string {
  return new Intl.NumberFormat('ru-RU').format(amountKopecks / 100) + ' ₽';
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Дата не указана';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
}

function safeRobokassaUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'auth.robokassa.ru'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
