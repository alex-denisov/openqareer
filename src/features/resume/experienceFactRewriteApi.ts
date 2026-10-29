import { apiFetch, readDataObject } from '../coach/apiClient';
import type { FactRewriteProposal } from '../../../server/domain/experienceFactRewrite';
import type { ResumeFactRewriteRecord } from '../../../server/domain/resumeDraft';

const BASE = '/api/v1/candidate/experience-fact-rewrite';

/** The consultant's bullets for the facts on offer; `null` when there is nothing to rewrite. */
export async function requestFactRewrite(): Promise<FactRewriteProposal | null> {
  const response = await apiFetch(BASE, { method: 'POST' });
  return (await readDataObject<{ proposal: FactRewriteProposal | null }>(response)).proposal;
}

export async function applyFactRewrite(proposalId: string): Promise<ResumeFactRewriteRecord> {
  const response = await apiFetch(`${BASE}/${encodeURIComponent(proposalId)}/apply`, {
    method: 'POST',
  });
  return (await readDataObject<{ rewrite: ResumeFactRewriteRecord }>(response)).rewrite;
}

export async function revertFactRewrite(rewriteId: string): Promise<void> {
  const response = await apiFetch(`${BASE}/${encodeURIComponent(rewriteId)}/revert`, {
    method: 'POST',
  });
  await readDataObject<{ reverted: boolean }>(response);
}
