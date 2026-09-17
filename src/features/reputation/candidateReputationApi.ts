import type { CandidateReputationAudit } from '../../../shared/candidateReputation';
import { apiFetch, readData } from '../coach/apiClient';

export interface StartAuditOptions {
  experience?: Array<{
    id: string;
    company: string;
    role: string;
    startDate: string;
    endDate?: string;
    current?: boolean;
  }>;
  externalProfiles?: Array<{
    platform: string;
    company: string;
    role: string;
    startDate: string;
    endDate?: string;
    current?: boolean;
  }>;
  publicPosts?: Array<{
    id: string;
    sourcePlatform: string;
    sourceUrl?: string;
    publishedAt?: string;
    content: string;
  }>;
}

export async function getLatestReputationAudit(): Promise<CandidateReputationAudit | null> {
  const response = await apiFetch('/api/v1/candidate/reputation-audit');
  const data = await readData<{ audit: CandidateReputationAudit | null }>(response);
  return data.audit;
}

export async function startReputationAudit(
  options?: StartAuditOptions,
): Promise<CandidateReputationAudit> {
  const response = await apiFetch('/api/v1/candidate/reputation-audit/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ options }),
  });
  const data = await readData<{ audit: CandidateReputationAudit }>(response);
  return data.audit;
}
