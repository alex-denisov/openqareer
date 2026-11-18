import type {
  VacancyTriage,
  VacancyTriageAnswers,
} from '../../../../shared/b640Vacancies';
import { apiFetch, malformedResponseError, readDataObject } from '../../coach/apiClient';

const TRIAGE_URL = '/api/v1/candidate/b640/vacancy-triage';

function isTriage(value: unknown): value is VacancyTriage {
  const data = value as Partial<VacancyTriage>;
  return Array.isArray(data.rows) && Array.isArray(data.questions) && typeof data.summary === 'object';
}

/** Что разбирать: показанные вакансии по id или всю подборку по строке фильтров списка. */
export type TriageTarget =
  | { readonly clusterIds: readonly string[] }
  | { readonly query: string };

/** Разбор по правилам: ничего не пишет, ответы на вопросы кладутся в тело. */
export async function requestTriage(
  target: TriageTarget,
  answers: VacancyTriageAnswers,
  signal?: AbortSignal,
): Promise<VacancyTriage> {
  const response = await apiFetch(TRIAGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...target, answers }),
    signal,
  });
  const data = await readDataObject<VacancyTriage>(response);
  if (!isTriage(data)) throw malformedResponseError();
  return data;
}
