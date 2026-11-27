import type {
  ApplicationQuestionnaire,
  AtsFormInput,
  QuestionnaireAnswer,
} from '../../../../../shared/applicationQuestionnaire';
import type { HhForm } from '../../../../../shared/hhCandidateSession';
import { apiFetch, readDataObject } from '../../../coach/apiClient';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const base = (vacancyId: string): string =>
  `/api/v1/candidate/vacancies/${encodeURIComponent(vacancyId)}/questionnaire`;

/** Анкета работодателя по вакансии (B641): вопросы, ответы кандидата и подсказки из профиля. */
export async function getQuestionnaire(
  vacancyId: string,
  signal?: AbortSignal,
): Promise<ApplicationQuestionnaire> {
  return readDataObject<ApplicationQuestionnaire>(await apiFetch(base(vacancyId), { signal }));
}

export async function saveQuestionnaireAnswers(
  vacancyId: string,
  answers: readonly QuestionnaireAnswer[],
): Promise<ApplicationQuestionnaire> {
  const response = await apiFetch(`${base(vacancyId)}/answers`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ answers }),
  });
  return readDataObject<ApplicationQuestionnaire>(response);
}

/** B641: вопросы анкеты, прочитанные приложением в окне hh.ru кандидата. */
export async function saveHhForm(vacancyId: string, form: HhForm): Promise<ApplicationQuestionnaire> {
  const response = await apiFetch(`${base(vacancyId)}/hh-form`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ url: form.url, questions: form.questions }),
  });
  return readDataObject<ApplicationQuestionnaire>(response);
}

/** B787: вопросы формы работодателя, прочитанные приложением. */
export async function saveAtsForm(
  vacancyId: string,
  form: AtsFormInput,
): Promise<ApplicationQuestionnaire> {
  const response = await apiFetch(`${base(vacancyId)}/ats-form`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(form),
  });
  return readDataObject<ApplicationQuestionnaire>(response);
}

export async function markQuestionnaireSubmitted(vacancyId: string): Promise<void> {
  const response = await apiFetch(`${base(vacancyId)}/submitted`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: '{}',
  });
  await readDataObject<{ submittedAt: string }>(response);
}
