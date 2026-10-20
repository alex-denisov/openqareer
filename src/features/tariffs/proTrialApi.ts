import { apiFetch, readData } from '../coach/apiClient';

export interface CandidateProTrial {
  readonly status: 'eligible' | 'active' | 'expired' | 'unavailable';
  readonly startedAt: string | null;
  readonly expiresAt: string | null;
  readonly serverNow: string;
}

export async function getProTrial(): Promise<CandidateProTrial> {
  return readData<CandidateProTrial>(await apiFetch('/api/v1/candidate/billing/trial'));
}

export async function activateProTrial(): Promise<CandidateProTrial> {
  return readData<CandidateProTrial>(
    await apiFetch('/api/v1/candidate/billing/trial', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  );
}
