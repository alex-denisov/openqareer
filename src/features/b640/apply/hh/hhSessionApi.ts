import type {
  HhApplyAttempt,
  HhApplyOutcome,
  HhConsentReport,
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
export async function getHhResumes(
  signal?: AbortSignal,
  /** Резюме, выбранное или подходящее этой вакансии. */
  vacancyId?: string,
): Promise<HhResumeSnapshot | null> {
  const query = vacancyId ? `?${new URLSearchParams({ vacancyId }).toString()}` : '';
  const response = await apiFetch(`${BASE}/resumes${query}`, { signal });
  const body = (await response.json()) as { data?: HhResumeSnapshot | null };
  if (!response.ok) throw new Error('hh_resumes_unavailable');
  return body.data ?? null;
}

export async function saveHhResumes(
  resumes: readonly HhResumeSummary[],
  selected: HhResumeContent | null,
  contents?: readonly HhResumeContent[],
  /** Отклик на вакансию: общий выбор резюме не меняется. */
  vacancyId?: string,
): Promise<HhResumeSnapshot> {
  const response = await apiFetch(`${BASE}/resumes`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      resumes,
      selected,
      ...(contents ? { contents } : {}),
      ...(vacancyId ? { vacancyId } : {}),
    }),
  });
  return readDataObject<HhResumeSnapshot>(response);
}

/** Каким резюме откликаться на эту вакансию. */
export async function chooseHhResumeFor(vacancyId: string, resumeId: string): Promise<HhResumeSnapshot> {
  const response = await apiFetch(`${BASE}/resumes/choice`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ vacancyId, resumeId }),
  });
  return readDataObject<HhResumeSnapshot>(response);
}

export interface HhResumeVacancyReview extends HhResumeReview {
  readonly vacancyId: string;
}

/** B678: какое из прочитанных резюме hh.ru подходит вакансии и чего в каждом не хватает; по просьбе — с числом правок. */
export async function getHhResumeReview(vacancyId: string, withEdits = false): Promise<HhResumeVacancyReview> {
  const query = new URLSearchParams({ vacancyId, ...(withEdits ? { edits: '1' } : {}) }).toString();
  const response = await apiFetch(`${BASE}/resumes/review?${query}`);
  return readDataObject<HhResumeVacancyReview>(response);
}

/** Начать отклик: сервер проверяет подтверждение, резюме и суточный лимит. */
export async function startHhApply(vacancyId: string, resumeId: string, vacancyTitle?: string): Promise<HhApplyAttempt> {
  const response = await apiFetch(`${BASE}/applications`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ vacancyId, resumeId, confirmed: true, ...(vacancyTitle ? { vacancyTitle } : {}) }),
  });
  return readDataObject<HhApplyAttempt>(response);
}

export async function finishHhApply(
  attemptId: string,
  outcome: HhApplyOutcome,
  failureCode?: string,
  vacancyId?: string,
  consent?: HhConsentReport,
): Promise<void> {
  const response = await apiFetch(`${BASE}/applications/${encodeURIComponent(attemptId)}/result`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ outcome, ...(failureCode ? { failureCode } : {}), ...(vacancyId ? { vacancyId } : {}), ...consent }),
  });
  await readDataObject<object>(response);
}

export interface HhResumeEdits {
  readonly resumeId: string;
  readonly vacancyId: string;
  readonly edits: readonly HhResumeEdit[];
}

/** B678: правки выбранного резюме hh.ru «было → станет» по профилю платформы. */
export async function getHhResumeEdits(vacancyId: string, signal?: AbortSignal): Promise<HhResumeEdits> {
  const query = new URLSearchParams({ vacancyId }).toString();
  const response = await apiFetch(`${BASE}/resumes/edits?${query}`, { signal });
  return readDataObject<HhResumeEdits>(response);
}
