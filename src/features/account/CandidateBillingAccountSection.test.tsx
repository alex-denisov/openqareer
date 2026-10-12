// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as billingApi from '../shell/candidateBillingApi';
import { CandidateBillingAccountSection } from './CandidateBillingAccountSection';

const summary: billingApi.CandidateBillingSummary = {
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

const emptyReceipts = { receipts: [], nextCursor: null };
const receiptWithoutUrl: billingApi.CandidateBillingReceipt = {
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
};
const cancellation: billingApi.CandidateBillingCancellation = {
  planId: 'basic',
  status: 'active',
  currentPeriodEndsAt: '2026-11-08T00:00:00.000Z',
  nextChargeAt: null,
  autoRenew: false,
  cancellationEventId: 'event-1',
};

describe('CandidateBillingAccountSection', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function mount(onOpenTariffs = vi.fn()) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<CandidateBillingAccountSection onOpenTariffs={onOpenTariffs} />);
      await Promise.resolve();
    });
    return onOpenTariffs;
  }

  it('shows the server plan, next charge and honest receipt availability', async () => {
    vi.spyOn(billingApi, 'getCandidateBillingSummary').mockResolvedValue(summary);
    vi.spyOn(billingApi, 'getCandidateBillingReceipts').mockResolvedValue({
      receipts: [receiptWithoutUrl],
      nextCursor: null,
    });
    vi.spyOn(billingApi, 'cancelCandidateBillingRenewal').mockResolvedValue(cancellation);
    await mount();

    expect(container.textContent).toContain('Basic');
    expect(container.textContent).toContain('Следующее списание');
    expect(container.textContent?.replace(/\u00a0/gu, ' ')).toContain('3 990 ₽');
    expect(container.textContent).toContain('Ссылка на чек пока не получена');
    expect(container.textContent).toContain('Сменить тариф');
  });

  it('cancels renewal and keeps the paid period visible', async () => {
    vi.spyOn(billingApi, 'getCandidateBillingSummary').mockResolvedValue(summary);
    vi.spyOn(billingApi, 'getCandidateBillingReceipts').mockResolvedValue(emptyReceipts);
    const cancel = vi.spyOn(billingApi, 'cancelCandidateBillingRenewal').mockResolvedValue(cancellation);
    await mount();

    const button = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Отключить автопродление'),
    ) as HTMLButtonElement;
    await act(async () => button.click());

    expect(cancel).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Автопродление отключено');
    expect(container.textContent).toContain('Доступ действует до 8 ноября');
  });

  it('opens tariff selection from the account subscription section', async () => {
    vi.spyOn(billingApi, 'getCandidateBillingSummary').mockResolvedValue(summary);
    vi.spyOn(billingApi, 'getCandidateBillingReceipts').mockResolvedValue(emptyReceipts);
    vi.spyOn(billingApi, 'cancelCandidateBillingRenewal').mockResolvedValue(cancellation);
    const onOpenTariffs = await mount();

    const button = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Сменить тариф'),
    ) as HTMLButtonElement;
    act(() => button.click());

    expect(onOpenTariffs).toHaveBeenCalledOnce();
  });
});
