import type {
  RejectionCandidateReason,
  RejectionReason,
  RejectionReview,
} from '../../../../../shared/rejectionReview';
import { apiFetch, readDataObject } from '../../../coach/apiClient';

const REVIEW = '/api/v1/candidate/applications/rejection-review';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Разбор отказов (B679): догадки по отказам, отметки кандидата и рекомендации. */
export async function getRejectionReview(signal?: AbortSignal): Promise<RejectionReview> {
  return readDataObject<RejectionReview>(await apiFetch(REVIEW, { signal }));
}

export async function saveRejectionReason(
  applicationId: string,
  reason: RejectionReason,
  note: string | null,
): Promise<RejectionCandidateReason> {
  const response = await apiFetch(
    `/api/v1/candidate/applications/${encodeURIComponent(applicationId)}/rejection-reason`,
    { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ reason, note }) },
  );
  return readDataObject<RejectionCandidateReason>(response);
}

export async function saveReviewFeedback(helped: boolean): Promise<void> {
  const response = await apiFetch(`${REVIEW}/feedback`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ helped }),
  });
  await readDataObject<{ helped: boolean }>(response);
}
