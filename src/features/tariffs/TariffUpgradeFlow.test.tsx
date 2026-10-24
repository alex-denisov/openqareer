// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as coachApi from '../coach/coachApi';
import * as billingApi from '../shell/candidateBillingApi';
import type { CandidateBillingSummary } from '../shell/candidateBillingApi';
import * as upgradeApi from './tariffUpgradeApi';
import { TariffUpgradeFlow, type TariffUpgradeContext } from './TariffUpgradeFlow';
import { CareerTariffsView } from './CareerTariffsView';
import { BillingManagementPanel } from './BillingManagementPanel';

const freeSummary: CandidateBillingSummary = {
  currentPlan: 'free',
  subscription: null,
  plans: [
    { id: 'basic', name: 'Basic', amountKopecks: 399_000, currency: 'RUB', interval: 'month' },
    { id: 'pro', name: 'Pro', amountKopecks: 990_000, currency: 'RUB', interval: 'month' },
    { id: 'max', name: 'Max', amountKopecks: 3_990_000, currency: 'RUB', interval: 'month' },
  ],
};

const basicSummary: CandidateBillingSummary = {
  ...freeSummary,
  currentPlan: 'basic',
  subscription: {
    status: 'active',
    currentPeriodEndsAt: '2026-11-08T00:00:00.000Z',
    nextChargeAt: null,
    autoRenew: false,
  },
};

const pendingCheckout: upgradeApi.CandidateCheckout = {
  invoiceId: 731,
  planId: 'basic',
  amountKopecks: 399_000,
  currency: 'RUB',
  status: 'pending',
  autoRenew: false,
  paymentUrl: 'https://auth.robokassa.ru/Merchant/Index?InvoiceID=731',
  createdAt: '2026-10-11T12:00:00.000Z',
};

const paidCheckout: upgradeApi.CandidateCheckout = { ...pendingCheckout, status: 'paid' };
const renewalCheckout: upgradeApi.CandidateCheckout = { ...pendingCheckout, autoRenew: true };

describe('TariffUpgradeFlow', () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('offers no downgrade between paid tiers', async () => {
    const summary: CandidateBillingSummary = {
      ...basicSummary,
      currentPlan: 'pro',
      subscription: {
        status: 'active',
        currentPeriodEndsAt: '2026-11-08T00:00:00.000Z',
        nextChargeAt: '2026-11-08T00:00:00.000Z',
        autoRenew: true,
      },
      plans: [
        ...basicSummary.plans,
        { id: 'pro', name: 'Pro', amountKopecks: 990_000, currency: 'RUB', interval: 'month' },
      ],
    };
    const checkout = vi.spyOn(upgradeApi, 'createCandidateCheckout');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<CareerTariffsView activeTierId="pro" billingSummary={summary} />);
      await Promise.resolve();
    });

    expect(host.textContent).not.toContain('Понизить до');
    expect(host.textContent).not.toContain('пока недоступн');
    expect(host.textContent).toContain('Вернуться на Free');
    expect(checkout).not.toHaveBeenCalled();
  });

  it('shows no renewal button while auto-renewal is not built', async () => {
    const summary: CandidateBillingSummary = {
      ...basicSummary,
      subscription: { ...basicSummary.subscription!, nextChargeAt: null, autoRenew: false },
    };
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <BillingManagementPanel
          summary={summary}
          receipts={[]}
          receiptState="ready"
          nextCursor={null}
          loadingMore={false}
          loadMoreError={false}
          cancellationState="idle"
          onCancelRenewal={vi.fn()}
          onRetryReceipts={vi.fn()}
          onLoadMore={vi.fn()}
        />,
      );
      await Promise.resolve();
    });

    expect(host.textContent).not.toContain('Включить автопродление');
    expect(host.textContent).not.toContain('пока недоступн');
  });

  async function mount(context: TariffUpgradeContext, summary = freeSummary) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<TariffUpgradeFlow context={context} summary={summary} onClose={vi.fn()} />);
      await Promise.resolve();
    });
  }

  it('creates a priced Basic checkout and enables it only after the server confirms payment', async () => {
    const getSession = vi.spyOn(coachApi, 'getSession').mockResolvedValue({
      username: 'qa.candidate',
      email: 'verified@example.test',
      displayName: 'Тестовый кандидат',
      role: 'candidate',
      isTest: true,
      candidateId: 'candidate-b470',
      emailVerified: true,
    });
    vi.spyOn(upgradeApi, 'createCandidateCheckout').mockResolvedValue(pendingCheckout);
    vi.spyOn(upgradeApi, 'getCandidateCheckout').mockResolvedValue(paidCheckout);
    const getSummary = vi
      .spyOn(billingApi, 'getCandidateBillingSummary')
      .mockResolvedValue(basicSummary);
    await mount({ kind: 'plan', planId: 'basic' });

    expect(host.textContent).toContain('Basic');
    expect(host.textContent?.replace(/[\u00a0\u202f]/gu, ' ')).toContain('3 990 ₽');
    expect(host.textContent).not.toContain('письмо за 2 дня');
    clickButton(host, 'Перейти на Basic');
    await flush();
    expect(host.textContent).toContain('Ваш заказ');
    expect(host.textContent).toContain('verified@example.test');

    clickButton(host, 'Перейти к оплате, 3 990 ₽');
    await flush();
    expect(upgradeApi.createCandidateCheckout).toHaveBeenCalledWith({
      planId: 'basic',
      autoRenew: false,
      idempotencyKey: expect.any(String),
    });
    expect(host.querySelector('a[href^="https://auth.robokassa.ru/"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Basic подключён');

    clickButton(host, 'Проверить статус');
    await flush();
    expect(upgradeApi.getCandidateCheckout).toHaveBeenCalledWith(731);
    expect(getSummary).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('Basic подключён');
    expect(host.textContent).toContain('8 ноября');
    expect(getSession).toHaveBeenCalled();
  });

  it('does not create another checkout when the server says the candidate already has the plan', async () => {
    vi.spyOn(upgradeApi, 'createCandidateCheckout').mockResolvedValue(pendingCheckout);
    await mount({ kind: 'plan', planId: 'basic' }, basicSummary);

    expect(host.textContent).toContain('Basic уже подключён');
    expect(upgradeApi.createCandidateCheckout).not.toHaveBeenCalled();
  });

  it('uses the Basic and Pro offer for the action that triggered the paywall', async () => {
    vi.spyOn(upgradeApi, 'createCandidateCheckout').mockResolvedValue(pendingCheckout);
    await mount({ kind: 'feature', feature: 'resume' });
    expect(host.textContent).toContain('Резюме под вакансию: тариф Basic');
    expect(host.textContent).toContain('Перейти на Basic');

    await act(async () => {
      root.render(
        <TariffUpgradeFlow
          key="applications"
          context={{ kind: 'feature', feature: 'applications' }}
          summary={freeSummary}
          onClose={vi.fn()}
        />,
      );
      await Promise.resolve();
    });
    expect(host.textContent).toContain('Отправка откликов платформой: тариф Pro');
    expect(host.textContent).toContain('Перейти на Pro');
  });

  it('opens payment-method recovery at checkout and preserves recurring consent', async () => {
    vi.spyOn(coachApi, 'getSession').mockResolvedValue({
      username: 'qa.candidate',
      email: 'verified@example.test',
      displayName: 'Тестовый кандидат',
      role: 'candidate',
      isTest: true,
      candidateId: 'candidate-b470',
      emailVerified: true,
    });
    vi.spyOn(upgradeApi, 'createCandidateCheckout').mockResolvedValue(renewalCheckout);
    await mount(
      { kind: 'payment-method', planId: 'basic' },
      {
        ...basicSummary,
        subscription: { ...basicSummary.subscription!, status: 'past_due' },
      },
    );

    await flush();
    expect(host.textContent).toContain('Обновить способ оплаты');
    expect(host.querySelector<HTMLInputElement>('input[name="auto-renew"]')?.checked).toBe(true);
    clickButton(host, 'Перейти к оплате, 3 990 ₽');
    await flush();

    expect(upgradeApi.createCandidateCheckout).toHaveBeenCalledWith({
      planId: 'basic',
      autoRenew: true,
      idempotencyKey: expect.any(String),
    });
    expect(host.querySelector('a[href^="https://auth.robokassa.ru/"]')).not.toBeNull();
  });

  it('submits an Executive request only after the candidate opts in and reflects the server waitlist state', async () => {
    const request = vi.spyOn(upgradeApi, 'createExecutiveSearchRequest').mockResolvedValue({
      id: 'b070e908-b525-4fb9-9aa4-3b289d5d190b',
      task: 'Найти CTO в финтех-компанию',
      timeline: 'До конца года',
      status: 'waitlisted',
      profileSharingConsent: true,
      profileSharingConsentAt: '2026-10-11T12:00:00.000Z',
      profileSharingConsentVersion: 'executive-profile-sharing-v1',
      createdAt: '2026-10-11T12:00:00.000Z',
      updatedAt: '2026-10-11T12:00:00.000Z',
    });
    await mount({ kind: 'executive' });

    const task = host.querySelector<HTMLTextAreaElement>('textarea[name="task"]');
    const timeline = host.querySelector<HTMLInputElement>('input[name="timeline"]');
    expect(task).not.toBeNull();
    expect(timeline).not.toBeNull();
    setInput(task!, 'Найти CTO в финтех-компанию');
    setInput(timeline!, 'До конца года');
    const submit = button(host, 'Отправить заявку');
    expect(submit.disabled).toBe(true);
    const consent = host.querySelector<HTMLInputElement>('input[name="profile-consent"]');
    expect(consent).not.toBeNull();
    await act(async () => consent!.click());
    expect(submit.disabled).toBe(false);

    await act(async () => submit.click());
    await flush();
    expect(request).toHaveBeenCalledWith({
      task: 'Найти CTO в финтех-компанию',
      timeline: 'До конца года',
      profileSharingConsent: true,
      idempotencyKey: expect.any(String),
    });
    expect(host.textContent).toContain('Вы в списке ожидания');
    expect(host.textContent).toContain('Оплата не списывалась');
    expect(host.textContent).not.toContain('ответит в течение недели на почту');
  });
});

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((item) =>
    item.textContent?.replace(/[\u00a0\u202f]+/gu, ' ').includes(label),
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

function clickButton(host: HTMLElement, label: string): void {
  act(() => button(host, label).click());
}

function setInput(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  act(() => {
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
