import { apiFetch, CoachApiError, readDataObject, throwApiError } from '../coach/apiClient';

export type SkillQuizLevel = 'junior' | 'middle' | 'senior';

export interface CoveringFact {
  readonly memoryId: string;
  readonly statement: string;
  readonly sourceMessageIds: readonly string[];
  readonly at: string;
}

export interface ConversationCoverage {
  readonly name: string;
  readonly state: 'discussed' | 'not_checked';
  readonly facts: readonly CoveringFact[];
}

export interface SkillConfirmation {
  readonly id: string;
  readonly name: string;
  readonly status: string | null;
  readonly source: string | null;
  readonly verifiedAt: string | null;
  readonly quizCheckable: boolean;
  readonly attemptsLeftToday: number;
  readonly lastAttempt: {
    readonly at: string;
    readonly scorePercent: number;
    readonly passed: boolean;
  } | null;
  readonly conversation: ConversationCoverage;
}

export interface SkillConfirmationsResponse {
  readonly passingScorePercent: number;
  readonly skills: readonly SkillConfirmation[];
}

export interface GeneratedSkillQuiz {
  readonly attemptId: string;
  readonly skillName: string;
  readonly level: SkillQuizLevel;
  readonly passingScorePercent: number;
  readonly questions: readonly {
    readonly id: string;
    readonly question: string;
    readonly options: readonly string[];
  }[];
}

export interface SkillQuizReviewItem {
  readonly questionId: string;
  readonly question: string;
  readonly selectedOptionIndex: number | null;
  readonly correctOptionIndex: number;
  readonly isCorrect: boolean;
  readonly explanation: string;
}

export interface SkillQuizSubmitResult {
  readonly attemptId: string;
  readonly skillName: string;
  readonly result: {
    readonly scorePercent: number;
    readonly correctAnswersCount: number;
    readonly totalQuestions: number;
    readonly passed: boolean;
    readonly status: string;
    readonly source: string;
    readonly verifiedAt: string;
    readonly review: readonly SkillQuizReviewItem[];
  };
}

const ERROR_TEXTS: Readonly<Record<string, string>> = {
  skill_quiz_not_checkable:
    'Этот навык тестом не проверить. Разберите его в беседе с консультантом.',
  skill_quiz_attempts_exhausted: 'Две попытки за сутки использованы. Попробуйте завтра.',
  skill_quiz_unavailable: 'Не удалось собрать вопросы. Попробуйте ещё раз через минуту.',
  skill_not_in_profile: 'Этого навыка нет в профиле. Обновите страницу.',
  skill_already_confirmed: 'Навык уже подтверждён, результат не изменит его статус.',
};

const FALLBACK_TEXT = 'Не получилось выполнить действие. Попробуйте ещё раз.';

/** A human sentence for a failed call; the server's raw message is never shown. */
export function skillConfirmationErrorText(error: unknown): string {
  if (error instanceof CoachApiError) return ERROR_TEXTS[error.code] ?? FALLBACK_TEXT;
  return FALLBACK_TEXT;
}

async function readOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  return throwApiError(response);
}

async function postJson(path: string, body: unknown, idempotencyKey?: string): Promise<Response> {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  return readOk(response);
}

export async function getSkillConfirmations(
  signal?: AbortSignal,
): Promise<SkillConfirmationsResponse> {
  const response = await readOk(
    await apiFetch('/api/v1/candidate/skill-confirmations', { signal }),
  );
  const data = await readDataObject<SkillConfirmationsResponse>(response);
  return { ...data, skills: Array.isArray(data.skills) ? data.skills : [] };
}

export async function generateSkillQuiz(input: {
  readonly skillName: string;
  readonly level: SkillQuizLevel;
}): Promise<GeneratedSkillQuiz> {
  const response = await postJson('/api/v1/candidate/skill-quiz/generate', input);
  return readDataObject<GeneratedSkillQuiz>(response);
}

export async function submitSkillQuiz(input: {
  readonly attemptId: string;
  readonly answers: Readonly<Record<string, number>>;
}): Promise<SkillQuizSubmitResult> {
  const response = await postJson(
    `/api/v1/candidate/skill-quiz/attempts/${encodeURIComponent(input.attemptId)}/submit`,
    { answers: input.answers },
  );
  return readDataObject<SkillQuizSubmitResult>(response);
}

export async function applySkillQuizAttempt(input: {
  readonly attemptId: string;
  readonly idempotencyKey: string;
}): Promise<{ readonly commandId: string }> {
  const response = await postJson(
    `/api/v1/candidate/skill-quiz/attempts/${encodeURIComponent(input.attemptId)}/apply`,
    {},
    input.idempotencyKey,
  );
  return readDataObject<{ commandId: string }>(response);
}
