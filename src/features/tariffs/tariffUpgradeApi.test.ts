import { afterEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../coach/apiClient';
import {
  createCandidateCheckout,
  createExecutiveSearchRequest,
  getCandidateCheckout,
} from './tariffUpgradeApi';

const checkout = {
  invoiceId: 731,
  planId: 'basic' as const,
  amountKopecks: 399_000,
  currency: 'RUB' as const,
  status: 'pending' as const,
  autoRenew: false,
  paymentUrl: 'https://auth.robokassa.ru/Merchant/Index?InvoiceID=731',
  createdAt: '2026-10-11T12:00:00.000Z',
};

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('tariffUpgradeApi', () => {
  afterEach(() => vi.restoreAllMocks());

  it('creates a candidate-scoped checkout with server-priced plan and idempotency key', async () => {
    const fetch = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(response(checkout, 201));

    await expect(
      createCandidateCheckout({ planId: 'basic', autoRenew: false, idempotencyKey: 'order:731' }),
    ).resolves.toEqual(checkout);

    expect(fetch).toHaveBeenCalledWith('/api/v1/candidate/billing/checkouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'order:731' },
      body: JSON.stringify({ planId: 'basic', autoRenew: false }),
    });
  });

  it('reads the confirmed checkout state by the candidate-owned invoice id', async () => {
    const fetch = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(response(checkout));

    await expect(getCandidateCheckout(731)).resolves.toEqual(checkout);

    expect(fetch).toHaveBeenCalledWith('/api/v1/candidate/billing/checkouts/731');
  });

  it('submits the Executive request with task, timeline and an idempotency key', async () => {
    const submitted = {
      id: 'b070e908-b525-4fb9-9aa4-3b289d5d190b',
      task: 'Найти CTO в финтех-компанию',
      timeline: 'До конца года',
      status: 'waitlisted' as const,
      createdAt: '2026-10-11T12:00:00.000Z',
      updatedAt: '2026-10-11T12:00:00.000Z',
    };
    const fetch = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(response(submitted, 201));

    await expect(
      createExecutiveSearchRequest({
        task: submitted.task,
        timeline: submitted.timeline,
        idempotencyKey: 'b070e908-b525-4fb9-9aa4-3b289d5d190b',
      }),
    ).resolves.toEqual(submitted);

    expect(fetch).toHaveBeenCalledWith('/api/v1/candidate/executive-requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'b070e908-b525-4fb9-9aa4-3b289d5d190b',
      },
      body: JSON.stringify({ task: submitted.task, timeline: submitted.timeline }),
    });
  });
});
