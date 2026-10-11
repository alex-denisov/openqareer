import { afterEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../coach/apiClient';
import {
  cancelCandidateBillingRenewal,
  getCandidateBillingReceipts,
  getCandidateBillingSummary,
} from './candidateBillingApi';

afterEach(() => vi.restoreAllMocks());

describe('candidate billing API', () => {
  it('reads the actual account plan from the candidate billing endpoint', async () => {
    const apiFetch = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(new Response(JSON.stringify({
      data: { currentPlan: 'basic', subscription: null, plans: [] },
    }), { status: 200 }));

    await expect(getCandidateBillingSummary()).resolves.toMatchObject({ currentPlan: 'basic' });
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/candidate/billing');
  });

  it('preserves the receipt cursor returned by the server', async () => {
    const apiFetch = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(new Response(JSON.stringify({
      data: [],
      meta: { requestId: 'request-1', nextCursor: '41' },
    }), { status: 200 }));

    await expect(getCandidateBillingReceipts({ cursor: '21', limit: 20 })).resolves.toEqual({
      receipts: [],
      nextCursor: '41',
    });
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/candidate/billing/receipts?cursor=21&limit=20');
  });

  it('turns off future charges with the one-click cancellation endpoint', async () => {
    const apiFetch = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(new Response(JSON.stringify({
      data: {
        planId: 'basic', status: 'active', currentPeriodEndsAt: '2026-11-08T00:00:00.000Z',
        nextChargeAt: null, autoRenew: false, cancellationEventId: 'event-1',
      },
    }), { status: 200 }));

    await expect(cancelCandidateBillingRenewal()).resolves.toMatchObject({
      autoRenew: false,
      cancellationEventId: 'event-1',
    });
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/v1/candidate/billing/subscription/cancel-renewal',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
