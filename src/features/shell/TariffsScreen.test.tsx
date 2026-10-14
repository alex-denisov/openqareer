// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as coachApi from '../coach/coachApi';
import * as billingApi from './candidateBillingApi';
import { TariffsScreen } from './TariffsScreen';
import * as upgradeApi from '../tariffs/tariffUpgradeApi';

vi.mock('./planRequestApi', () => ({
  usePlanRequests: () => ({ states: {}, dates: {}, send: vi.fn() }),
}));

const basicSummary: billingApi.CandidateBillingSummary = {
  currentPlan: 'basic',
  subscription: {
    status: 'active',
    currentPeriodEndsAt: '2026-11-08T00:00:00.000Z',
    nextChargeAt: '2026-11-08T00:00:00.000Z',
    autoRenew: true,
  },
  plans: [
    { id: 'basic', name: 'Basic', amountKopecks: 399_000, currency: 'RUB', interval: 'month' },
  ],
};

const freeSummary: billingApi.CandidateBillingSummary = {
  currentPlan: 'free',
  subscription: null,
  plans: [
    { id: 'basic', name: 'Basic', amountKopecks: 399_000, currency: 'RUB', interval: 'month' },
  ],
};

const pastDueSummary: billingApi.CandidateBillingSummary = {
  ...basicSummary,
  subscription: { ...basicSummary.subscription!, status: 'past_due', autoRenew: true },
};

const emptyReceipts = { receipts: [], nextCursor: null };

const canceledSubscription: billingApi.CandidateBillingCancellation = {
  planId: 'basic',
  status: 'active',
  currentPeriodEndsAt: '2026-11-08T00:00:00.000Z',
  nextChargeAt: null,
  autoRenew: false,
  cancellationEventId: 'event-1',
};

describe('TariffsScreen billing management', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function mount() {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<TariffsScreen />);
      await Promise.resolve();
    });
  }

  it('shows the server-confirmed plan, next charge amount and available receipt links', async () => {
    vi.spyOn(billingApi, 'getCandidateBillingSummary').mockResolvedValue(basicSummary);
    vi.spyOn(billingApi, 'getCandidateBillingReceipts').mockResolvedValue({
      receipts: [
        {
          invoiceId: 41,
          planId: 'basic',
          amountKopecks: 399_000,
          currency: 'RUB',
          paidAt: '2026-10-10T10:00:00.000Z',
          paymentMethod: null,
          receiptUrl: 'https://receipts.example.test/41',
          receiptStatus: 'done',
          fiscalDocumentNumber: '123456789',
          fiscalDate: '2026-10-10T10:00:02.000Z',
        },
      ],
      nextCursor: null,
    });
    vi.spyOn(billingApi, 'cancelCandidateBillingRenewal').mockResolvedValue(canceledSubscription);
    await mount();

    const desktop = container.querySelector('.career-tariffs-desktop') as HTMLElement;
    const text = desktop.textContent?.replace(/\u00a0/gu, ' ') ?? '';
    expect(text).toContain('Ваш тариф');
    expect(text).toContain('Basic');
    expect(text).toContain('Следующее списание');
    expect(text).toContain('3 990 ₽');
    expect(text).toContain('История платежей');
    expect(
      desktop.querySelector('a[href="https://receipts.example.test/41"]')?.textContent,
    ).toContain('Открыть чек');
    const ids = [...container.querySelectorAll('[id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('offers one-click cancellation and keeps access through the paid period', async () => {
    vi.spyOn(billingApi, 'getCandidateBillingSummary').mockResolvedValue(basicSummary);
    vi.spyOn(billingApi, 'getCandidateBillingReceipts').mockResolvedValue(emptyReceipts);
    const cancel = vi
      .spyOn(billingApi, 'cancelCandidateBillingRenewal')
      .mockResolvedValue(canceledSubscription);
    await mount();
    const desktop = container.querySelector('.career-tariffs-desktop') as HTMLElement;
    const button = [...desktop.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Отключить автопродление'),
    ) as HTMLButtonElement;

    await act(async () => button.click());

    expect(cancel).toHaveBeenCalledOnce();
    expect(desktop.textContent).toContain('Автопродление отключено');
    expect(desktop.textContent).toContain('Доступ действует до 8 ноября');
    expect(desktop.textContent).not.toContain('Следующее списание');
  });

  it('schedules a return to Free from the tariff card through server cancellation', async () => {
    vi.spyOn(billingApi, 'getCandidateBillingSummary').mockResolvedValue(basicSummary);
    vi.spyOn(billingApi, 'getCandidateBillingReceipts').mockResolvedValue(emptyReceipts);
    const cancel = vi
      .spyOn(billingApi, 'cancelCandidateBillingRenewal')
      .mockResolvedValue(canceledSubscription);
    await mount();
    const desktop = container.querySelector('.career-tariffs-desktop') as HTMLElement;
    const button = [...desktop.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Вернуться на Free'),
    ) as HTMLButtonElement;

    await act(async () => button.click());

    expect(cancel).toHaveBeenCalledOnce();
    expect(desktop.textContent).toContain('Автопродление отключено');
    expect(desktop.textContent).toContain('Доступ действует до 8 ноября');
  });



  it('opens payment-method recovery for a past-due subscription with renewal enabled', async () => {
    vi.spyOn(coachApi, 'getSession').mockResolvedValue({
      username: 'qa.candidate',
      email: 'verified@example.test',
      displayName: 'Тестовый кандидат',
      role: 'candidate',
      isTest: true,
      candidateId: 'candidate-aud-17',
      emailVerified: true,
    });
    vi.spyOn(upgradeApi, 'createCandidateCheckout').mockResolvedValue({
      invoiceId: 731,
      planId: 'basic',
      amountKopecks: 399_000,
      currency: 'RUB',
      status: 'pending',
      autoRenew: true,
      paymentUrl: 'https://auth.robokassa.ru/Merchant/Index?InvoiceID=731',
      createdAt: '2026-10-11T12:00:00.000Z',
    });
    vi.spyOn(billingApi, 'getCandidateBillingSummary').mockResolvedValue(pastDueSummary);
    vi.spyOn(billingApi, 'getCandidateBillingReceipts').mockResolvedValue(emptyReceipts);
    await mount();
    const desktop = container.querySelector('.career-tariffs-desktop') as HTMLElement;
    const update = [...desktop.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Обновить способ оплаты'),
    ) as HTMLButtonElement;

    await act(async () => update.click());

    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('Обновить способ оплаты');
    expect(dialog.querySelector<HTMLInputElement>('input[name="auto-renew"]')?.checked).toBe(true);
  });

  it('does not invent or render unsafe receipt URLs', async () => {
    vi.spyOn(billingApi, 'getCandidateBillingSummary').mockResolvedValue(basicSummary);
    vi.spyOn(billingApi, 'getCandidateBillingReceipts').mockResolvedValue({
      receipts: [
        {
          invoiceId: 42,
          planId: 'basic',
          amountKopecks: 399_000,
          currency: 'RUB',
          paidAt: '2026-10-10T10:00:00.000Z',
          paymentMethod: null,
          receiptUrl: 'javascript:alert(1)',
          receiptStatus: null,
          fiscalDocumentNumber: null,
          fiscalDate: null,
        },
      ],
      nextCursor: null,
    });
    vi.spyOn(billingApi, 'cancelCandidateBillingRenewal').mockResolvedValue(canceledSubscription);
    await mount();
    const desktop = container.querySelector('.career-tariffs-desktop') as HTMLElement;

    expect(desktop.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(desktop.textContent).toContain('Ссылка на чек пока не получена');
    expect(desktop.textContent).toContain('Номер фискального документа пока не получен');
  });

  it('does not guess that the candidate is on Free when the billing API fails, and can retry', async () => {
    const summary = vi
      .spyOn(billingApi, 'getCandidateBillingSummary')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(freeSummary);
    vi.spyOn(billingApi, 'getCandidateBillingReceipts').mockResolvedValue(emptyReceipts);
    vi.spyOn(billingApi, 'cancelCandidateBillingRenewal').mockResolvedValue(canceledSubscription);
    await mount();

    expect(container.textContent).toContain('Не удалось загрузить тариф');
    expect(container.textContent).not.toContain('Ваш тариф');
    const retry = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Повторить'),
    ) as HTMLButtonElement;
    await act(async () => retry.click());

    expect(summary).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.career-tariffs-desktop')?.textContent).toContain('Free');
  });

  it('loads previous receipts using the server cursor', async () => {
    vi.spyOn(billingApi, 'getCandidateBillingSummary').mockResolvedValue(basicSummary);
    const listReceipts = vi
      .spyOn(billingApi, 'getCandidateBillingReceipts')
      .mockResolvedValueOnce({
        receipts: [
          {
            invoiceId: 41,
            planId: 'basic',
            amountKopecks: 399_000,
            currency: 'RUB',
            paidAt: '2026-10-10T10:00:00.000Z',
            paymentMethod: null,
            receiptUrl: null,
            receiptStatus: null,
            fiscalDocumentNumber: null,
            fiscalDate: null,
          },
        ],
        nextCursor: '41',
      })
      .mockResolvedValueOnce({ receipts: [], nextCursor: null });
    vi.spyOn(billingApi, 'cancelCandidateBillingRenewal').mockResolvedValue(canceledSubscription);
    await mount();
    const desktop = container.querySelector('.career-tariffs-desktop') as HTMLElement;
    const more = [...desktop.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Показать предыдущие платежи'),
    ) as HTMLButtonElement;

    await act(async () => more.click());

    expect(listReceipts).toHaveBeenNthCalledWith(2, { cursor: '41', limit: 20 });
    expect(desktop.textContent).not.toContain('Показать предыдущие платежи');
  });

  it('shows Free without placing subscription history outside the current tier', async () => {
    vi.spyOn(billingApi, 'getCandidateBillingSummary').mockResolvedValue(freeSummary);
    vi.spyOn(billingApi, 'getCandidateBillingReceipts').mockResolvedValue(emptyReceipts);
    vi.spyOn(billingApi, 'cancelCandidateBillingRenewal').mockResolvedValue(canceledSubscription);
    await mount();
    const desktop = container.querySelector('.career-tariffs-desktop') as HTMLElement;

    expect(desktop.textContent).toContain('Free');
    expect(desktop.textContent).not.toContain('Списаний пока нет');
    expect(desktop.textContent).not.toContain('Оплаченных платежей пока нет');
    expect(
      [...desktop.querySelectorAll('button')].some((button) =>
        button.textContent?.includes('Отключить автопродление'),
      ),
    ).toBe(false);
  });

  it('keeps cancellation recoverable when the request fails', async () => {
    vi.spyOn(billingApi, 'getCandidateBillingSummary').mockResolvedValue(basicSummary);
    vi.spyOn(billingApi, 'getCandidateBillingReceipts').mockResolvedValue(emptyReceipts);
    const cancel = vi
      .spyOn(billingApi, 'cancelCandidateBillingRenewal')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(canceledSubscription);
    await mount();
    const desktop = container.querySelector('.career-tariffs-desktop') as HTMLElement;
    const button = [...desktop.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Отключить автопродление'),
    ) as HTMLButtonElement;

    await act(async () => button.click());
    expect(desktop.textContent).toContain('Не удалось отключить автопродление');
    expect(button.getAttribute('aria-disabled')).toBe('false');

    await act(async () => button.click());
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(desktop.textContent).toContain('Автопродление отключено');
  });

  it('lets the candidate retry a failed receipt-history request', async () => {
    vi.spyOn(billingApi, 'getCandidateBillingSummary').mockResolvedValue(basicSummary);
    const getReceipts = vi
      .spyOn(billingApi, 'getCandidateBillingReceipts')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(emptyReceipts);
    vi.spyOn(billingApi, 'cancelCandidateBillingRenewal').mockResolvedValue(canceledSubscription);
    await mount();
    const desktop = container.querySelector('.career-tariffs-desktop') as HTMLElement;
    expect(desktop.textContent).toContain('Не удалось загрузить историю платежей');
    const retry = [...desktop.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Повторить'),
    ) as HTMLButtonElement;

    await act(async () => retry.click());

    expect(getReceipts).toHaveBeenCalledTimes(2);
    expect(desktop.textContent).toContain('Оплаченных платежей пока нет');
  });
});
