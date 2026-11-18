import type {
  HhApplyAttempt,
  HhApplyOutcome,
  HhResumeContent,
  HhResumeSnapshot,
  HhResumeSummary,
} from '../../../../../shared/hhCandidateSession';
import { apiFetch, readDataObject } from '../../../coach/apiClient';

const BASE = '/api/v1/candidate/hh';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Резюме hh.ru, прочитанные в прошлый раз; `null` — ещё не читали. */
export async function getHhResumes(signal?: AbortSignal): Promise<HhResumeSnapshot | null> {
  const response = await apiFetch(`${BASE}/resumes`, { signal });
  const body = (await response.json()) as { data?: HhResumeSnapshot | null };
  if (!response.ok) throw new Error('hh_resumes_unavailable');
  return body.data ?? null;
}

export async function saveHhResumes(
  resumes: readonly HhResumeSummary[],
  selected: HhResumeContent | null,
): Promise<HhResumeSnapshot> {
  const response = await apiFetch(`${BASE}/resumes`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ resumes, selected }),
  });
  return readDataObject<HhResumeSnapshot>(response);
}

/** Начать отклик: сервер проверяет подтверждение, резюме и суточный лимит. */
export async function startHhApply(vacancyId: string, resumeId: string): Promise<HhApplyAttempt> {
  const response = await apiFetch(`${BASE}/applications`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ vacancyId, resumeId, confirmed: true }),
  });
  return readDataObject<HhApplyAttempt>(response);
}

export async function finishHhApply(
  attemptId: string,
  outcome: HhApplyOutcome,
  failureCode?: string,
): Promise<void> {
  const response = await apiFetch(`${BASE}/applications/${encodeURIComponent(attemptId)}/result`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ outcome, ...(failureCode ? { failureCode } : {}) }),
  });
  await readDataObject<object>(response);
}
