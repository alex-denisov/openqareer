import { apiFetch, readData } from '../coach/apiClient';

export type CandidateBillingPlanId = 'basic' | 'pro' | 'max';
export type CandidateCurrentPlanId = 'free' | CandidateBillingPlanId;

export interface CandidateBillingPlan {
  readonly id: CandidateBillingPlanId;
  readonly name: string;
  readonly amountKopecks: number;
  readonly currency: 'RUB';
  readonly interval: 'month';
}

export interface CandidateBillingSubscription {
  readonly status: 'active' | 'past_due' | 'canceled' | 'expired';
  readonly currentPeriodEndsAt: string;
  readonly nextChargeAt: string | null;
  readonly autoRenew: boolean;
}

export interface CandidateBillingSummary {
  readonly currentPlan: CandidateCurrentPlanId;
  readonly subscription: CandidateBillingSubscription | null;
  readonly plans: readonly CandidateBillingPlan[];
}

export interface CandidateBillingReceipt {
  readonly invoiceId: number;
  readonly planId: CandidateBillingPlanId;
  readonly amountKopecks: number;
  readonly currency: 'RUB';
  readonly paidAt: string | null;
  readonly paymentMethod: string | null;
  readonly receiptUrl: string | null;
  readonly receiptStatus: string | null;
  readonly fiscalDocumentNumber: string | null;
  readonly fiscalDate: string | null;
}

export interface CandidateBillingReceiptPage {
  readonly receipts: readonly CandidateBillingReceipt[];
  readonly nextCursor: string | null;
}

export interface CandidateBillingCancellation {
  readonly planId: CandidateBillingPlanId;
  readonly status: CandidateBillingSubscription['status'];
  readonly currentPeriodEndsAt: string;
  readonly nextChargeAt: null;
  readonly autoRenew: false;
  readonly cancellationEventId: string | null;
}

export async function getCandidateBillingSummary(): Promise<CandidateBillingSummary> {
  return readData<CandidateBillingSummary>(await apiFetch('/api/v1/candidate/billing'));
}

export async function getCandidateBillingReceipts(input: {
  readonly cursor?: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
} = {}): Promise<CandidateBillingReceiptPage> {
  const query = new URLSearchParams();
  if (input.cursor) query.set('cursor', input.cursor);
  query.set('limit', String(input.limit ?? 20));
  const url = `/api/v1/candidate/billing/receipts?${query.toString()}`;
  const response = input.signal
    ? await apiFetch(url, { signal: input.signal })
    : await apiFetch(url);
  const receipts = await readData<CandidateBillingReceipt[]>(response.clone());
  const envelope: unknown = await response.json();
  const nextCursor = readNextCursor(envelope);
  return { receipts, nextCursor };
}

export async function cancelCandidateBillingRenewal(): Promise<CandidateBillingCancellation> {
  return readData<CandidateBillingCancellation>(await apiFetch(
    '/api/v1/candidate/billing/subscription/cancel-renewal',
    { method: 'POST' },
  ));
}

function readNextCursor(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('meta' in value)) return null;
  const meta = value.meta;
  if (typeof meta !== 'object' || meta === null || !('nextCursor' in meta)) return null;
  return typeof meta.nextCursor === 'string' ? meta.nextCursor : null;
}
