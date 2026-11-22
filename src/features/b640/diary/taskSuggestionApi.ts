import { apiFetch, readData, throwApiError } from '../../coach/apiClient';

/** B743 · 2: подсказка следующей задачи по цели (d02a «Задачи»). Всё под флагом B640. */
const ROOT = '/api/v1/candidate/career-diary/goal-cards';

export interface TaskSuggestion {
  readonly id: string;
  readonly text: string;
  /** `ГГГГ-ММ-ДД`: срок, с которым подсказка станет задачей. */
  readonly dueDate: string;
}

const path = (goalId: string, tail = '') =>
  `${ROOT}/${encodeURIComponent(goalId)}/task-suggestion${tail}`;

/** Ответ не той формы — подсказки нет: кандидат её не увидит, ошибки тоже. */
function narrow(data: unknown): TaskSuggestion | null {
  if (!data || typeof data !== 'object') return null;
  const { id, text, dueDate } = data as Record<string, unknown>;
  const valid =
    typeof id === 'string' &&
    typeof text === 'string' &&
    text.trim() !== '' &&
    typeof dueDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/u.test(dueDate);
  return valid ? { id, text, dueDate } : null;
}

/** `null` — подсказки нет (модель не нашла задачи, данные не менялись после ответа кандидата). */
export async function getTaskSuggestion(goalId: string): Promise<TaskSuggestion | null> {
  return narrow(await readData<unknown>(await apiFetch(path(goalId))));
}

async function resolve(goalId: string, id: string, action: 'skip' | 'accept'): Promise<void> {
  const response = await apiFetch(path(goalId, `/${encodeURIComponent(id)}/${action}`), {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });
  if (!response.ok) await throwApiError(response);
}

/** Подсказка стала задачей плана. */
export const acceptTaskSuggestion = (goalId: string, id: string) => resolve(goalId, id, 'accept');

/** Кандидат отказался: подсказка не вернётся, пока данные цели не изменятся. */
export const skipTaskSuggestion = (goalId: string, id: string) => resolve(goalId, id, 'skip');
