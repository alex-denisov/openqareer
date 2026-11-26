import type { TextVariantList, VariantWish } from '../../../shared/textVariants';
import { apiFetch, readDataObject } from '../coach/apiClient';
import type { FactRewriteProposal } from '../../../server/domain/experienceFactRewrite';
import type { ResumeFactRewriteRecord } from '../../../server/domain/resumeDraft';

const BASE = '/api/v1/candidate/experience-fact-rewrite';

/** The consultant's bullets for the facts on offer; `null` when there is nothing to rewrite. */
export async function requestFactRewrite(): Promise<FactRewriteProposal | null> {
  const response = await apiFetch(BASE, { method: 'POST' });
  return (await readDataObject<{ proposal: FactRewriteProposal | null }>(response)).proposal;
}

/** Applies the proposal with the candidate's edits: bullet key → new text, or null to remove.
 * `only` — apply just these bullets, the rest stay on offer. */
export async function applyFactRewrite(
  proposalId: string,
  edits: Readonly<Record<string, string | null>> = {},
  only?: readonly string[],
  variantId?: string,
): Promise<ResumeFactRewriteRecord> {
  const response = await apiFetch(`${BASE}/${encodeURIComponent(proposalId)}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(only ? { only, ...(variantId ? { variantId } : {}) } : { edits }),
  });
  return (await readDataObject<{ rewrite: ResumeFactRewriteRecord }>(response)).rewrite;
}

export async function revertFactRewrite(rewriteId: string): Promise<void> {
  const response = await apiFetch(`${BASE}/${encodeURIComponent(rewriteId)}/revert`, {
    method: 'POST',
  });
  await readDataObject<{ reverted: boolean }>(response);
}

const variantsUrl = (proposalId: string) => `${BASE}/${encodeURIComponent(proposalId)}/variants`;

/** B786: сохранённые варианты пункта. */
export async function listFactRewriteVariants(
  proposalId: string,
  key: string,
  signal?: AbortSignal,
): Promise<TextVariantList> {
  const query = new URLSearchParams({ key }).toString();
  return readDataObject<TextVariantList>(
    await apiFetch(`${variantsUrl(proposalId)}?${query}`, { signal }),
  );
}

export async function createFactRewriteVariant(
  proposalId: string,
  key: string,
  wish: VariantWish,
): Promise<TextVariantList> {
  const response = await apiFetch(variantsUrl(proposalId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, wish }),
  });
  return readDataObject<TextVariantList>(response);
}
