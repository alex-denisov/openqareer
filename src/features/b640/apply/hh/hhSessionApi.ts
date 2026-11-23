import type {
  HhApplyAttempt,
  HhApplyOutcome,
  HhResumeContent,
  HhResumeEdit,
  HhResumeReview,
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
  contents?: readonly HhResumeContent[],
): Promise<HhResumeSnapshot> {
  const response = await apiFetch(`${BASE}/resumes`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ resumes, selected, ...(contents ? { contents } : {}) }),
  });
  return readDataObject<HhResumeSnapshot>(response);
}

export interface HhResumeVacancyReview extends HhResumeReview {
  readonly vacancyId: string;
}

/** B678: какое из прочитанных резюме hh.ru подходит вакансии и чего в каждом не хватает. */
export async function getHhResumeReview(vacancyId: string): Promise<HhResumeVacancyReview> {
  const query = new URLSearchParams({ vacancyId }).toString();
  const response = await apiFetch(`${BASE}/resumes/review?${query}`);
  return readDataObject<HhResumeVacancyReview>(response);
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

export interface HhResumeEdits {
  readonly resumeId: string;
  readonly vacancyId: string;
  readonly edits: readonly HhResumeEdit[];
}

/** B678: правки резюме hh.ru «было → станет» по профилю платформы; без `resumeId` — выбранного. */
export async function getHhResumeEdits(
  vacancyId: string,
  signal?: AbortSignal,
  resumeId?: string,
): Promise<HhResumeEdits> {
  const query = new URLSearchParams({ vacancyId, ...(resumeId ? { resumeId } : {}) }).toString();
  const response = await apiFetch(`${BASE}/resumes/edits?${query}`, { signal });
  return readDataObject<HhResumeEdits>(response);
}
