import type {
  ResumeEditDecision,
  ResumeEditsState,
} from '../../../../../shared/resumeVacancyEdits';
import { apiFetch, readDataObject } from '../../../coach/apiClient';

const pathOf = (vacancyId: string) =>
  `/api/v1/candidate/vacancies/${encodeURIComponent(vacancyId)}/resume-edits`;

/** Правки резюме под вакансию с решениями кандидата (B785). */
export async function getResumeEdits(
  vacancyId: string,
  signal?: AbortSignal,
): Promise<ResumeEditsState> {
  return readDataObject<ResumeEditsState>(await apiFetch(pathOf(vacancyId), { signal }));
}

export async function decideResumeEdit(
  vacancyId: string,
  decision: ResumeEditDecision,
): Promise<ResumeEditsState> {
  const response = await apiFetch(pathOf(vacancyId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
  return readDataObject<ResumeEditsState>(response);
}
