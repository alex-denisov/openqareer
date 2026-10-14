import { apiFetch, readData } from '../coach/apiClient';

export type PaidTariffPlanId = 'basic' | 'pro' | 'max';
export type CandidateCheckoutStatus = 'pending' | 'processing' | 'paid' | 'failed';

export interface CandidateCheckout {
  readonly invoiceId: number;
  readonly planId: PaidTariffPlanId;
  readonly amountKopecks: number;
  readonly currency: 'RUB';
  readonly status: CandidateCheckoutStatus;
  readonly autoRenew: boolean;
  readonly paymentUrl: string | null;
  readonly createdAt: string;
}

export type ExecutiveRequestStatus =
  'submitted' | 'waitlisted' | 'in_review' | 'accepted' | 'declined' | 'completed';

export interface CandidateExecutiveRequest {
  readonly id: string;
  readonly task: string;
  readonly timeline: string;
  readonly status: ExecutiveRequestStatus;
  readonly profileSharingConsent: boolean;
  readonly profileSharingConsentAt: string | null;
  readonly profileSharingConsentVersion: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export async function createCandidateCheckout(input: {
  readonly planId: PaidTariffPlanId;
  readonly autoRenew: boolean;
  readonly idempotencyKey: string;
}): Promise<CandidateCheckout> {
  const response = await apiFetch('/api/v1/candidate/billing/checkouts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify({ planId: input.planId, autoRenew: input.autoRenew }),
  });
  return readData<CandidateCheckout>(response);
}

export async function getCandidateCheckout(invoiceId: number): Promise<CandidateCheckout> {
  return readData<CandidateCheckout>(
    await apiFetch(`/api/v1/candidate/billing/checkouts/${invoiceId}`),
  );
}

export async function createExecutiveSearchRequest(input: {
  readonly task: string;
  readonly timeline: string;
  readonly profileSharingConsent: true;
  readonly idempotencyKey: string;
}): Promise<CandidateExecutiveRequest> {
  const response = await apiFetch('/api/v1/candidate/executive-requests', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify({
      task: input.task,
      timeline: input.timeline,
      profileSharingConsent: input.profileSharingConsent,
    }),
  });
  return readData<CandidateExecutiveRequest>(response);
}
