import type {
  ResumeEditDecision,
  ResumeVacancyEdit,
} from '../../../../../shared/resumeVacancyEdits';
import { apiFetch, readDataObject } from '../../../coach/apiClient';

interface EditsData {
  readonly edits: readonly ResumeVacancyEdit[];
}

const pathOf = (vacancyId: string) =>
  `/api/v1/candidate/vacancies/${encodeURIComponent(vacancyId)}/resume-edits`;

/** Правки резюме под вакансию с решениями кандидата (B785). */
export async function getResumeEdits(
  vacancyId: string,
  signal?: AbortSignal,
): Promise<readonly ResumeVacancyEdit[]> {
  return (await readDataObject<EditsData>(await apiFetch(pathOf(vacancyId), { signal }))).edits;
}

export async function decideResumeEdit(
  vacancyId: string,
  decision: ResumeEditDecision,
): Promise<readonly ResumeVacancyEdit[]> {
  const response = await apiFetch(pathOf(vacancyId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
  return (await readDataObject<EditsData>(response)).edits;
}
