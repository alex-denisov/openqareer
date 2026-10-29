import { apiFetch, readData } from '../coach/apiClient';

/** B561 slice 3: «Попросить рекомендацию» between a candidate and platform members. */
export interface IncomingReferralRequest {
  readonly id: string;
  readonly status: 'pending' | 'accepted';
  readonly companyName: string;
  readonly vacancyTitle: string;
  readonly createdAt: string;
  readonly requester: {
    readonly fullName: string;
    readonly headline: string | null;
    /** Given only after the member accepted. */
    readonly linkedinUrl: string | null;
  };
  /** The member's own contacts at the company. */
  readonly contacts: ReadonlyArray<{ readonly fullName: string; readonly roleTitle: string }>;
}

export async function requestReferral(vacancyId: string): Promise<{ status: string }> {
  const response = await apiFetch(
    '/api/v1/candidate/vacancies/' + encodeURIComponent(vacancyId) + '/referral-requests',
    { method: 'POST' },
  );
  return readData<{ status: string }>(response);
}

export async function listIncomingReferralRequests(): Promise<IncomingReferralRequest[]> {
  const response = await apiFetch('/api/v1/candidate/referral-requests/incoming', {
    method: 'GET',
    cache: 'no-store',
  });
  return (await readData<{ items: IncomingReferralRequest[] }>(response)).items;
}

export async function answerReferralRequest(
  requestId: string,
  decision: 'accept' | 'decline',
): Promise<void> {
  const response = await apiFetch(
    '/api/v1/candidate/referral-requests/' + encodeURIComponent(requestId) + '/answer',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    },
  );
  await readData<{ status: string }>(response);
}
