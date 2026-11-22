import type { ApplicationView } from '../../../../../server/domain/applicationDerivedFields';
import {
  buildSystemDesignTask,
  type SystemDesignTask,
} from '../../../../../server/domain/systemDesignTask';
import { apiFetch, readDataObject } from '../../../coach/apiClient';
import {
  getCurrentInterviewSession,
  startInterviewSession,
  submitInterviewAnswer,
  transitionInterviewSession,
  type InterviewAnswerMode,
  type InterviewSessionView,
} from '../../../interview/interviewSimulatorApi';
import type { TariffQuotaStatus } from '../../../tariffs/tariffQuotaApi';
import { trainingQuota } from './trainingQuota';
import { practiceChoice, type ReviewEvaluation, type SchemaToSave } from '../model/practiceModel';
import { findResponse } from './prepApi';

const URL = '/api/v1/candidate/b640/interview-sessions';

export type PracticeTask = Omit<SystemDesignTask, 'exampleAnswer'>;

export type PracticeLoad =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'other';
      readonly response: ApplicationView;
      readonly task: PracticeTask;
      readonly session: InterviewSessionView;
    }
  | {
      readonly kind: 'ready';
      readonly response: ApplicationView;
      readonly task: PracticeTask;
      /** `null` — тренировка ещё не начата (I3a). */
      readonly session: InterviewSessionView | null;
      /** `null` — тариф без счёта или счётчик не прочитался. */
      readonly quota: TariffQuotaStatus | null;
    };

export interface PracticeReview {
  readonly questionId: string;
  readonly evaluation: ReviewEvaluation;
  readonly exampleAnswer: string | null;
  readonly helpful: boolean | null;
  readonly schema: { readonly schema: SchemaToSave | null; readonly source: string } | null;
}

const questionPath = (sessionId: string, questionId: string, tail: string) =>
  `${URL}/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(questionId)}/${tail}`;

/** Условие — то же, что строит сервер: по вакансии отклика; образец ответа — только в разборе. */
export function practiceTask(response: ApplicationView): PracticeTask {
  const vacancy = response.vacancy;
  const { exampleAnswer: _example, ...task } = buildSystemDesignTask({
    vacancyTitle: vacancy?.title ?? 'роль отклика',
    company: vacancy?.companyHidden ? undefined : vacancy?.company,
    description: vacancy?.description,
  });
  return task;
}

/** Тренировка System Design по отклику: продолжить начатую или показать задачу. */
export async function loadPractice(responseId: string, signal: AbortSignal): Promise<PracticeLoad> {
  const response = await findResponse(responseId, signal);
  if (!response) return { kind: 'none' };
  const task = practiceTask(response);
  const [current, quota] = await Promise.all([getCurrentInterviewSession(signal), trainingQuota()]);
  const choice = practiceChoice(current, response.id);
  if (current && choice === 'other') return { kind: 'other', response, task, session: current };
  const kept = choice === 'resume' || choice === 'review' ? current : null;
  return { kind: 'ready', response, task, session: kept, quota };
}

export function startPractice(
  response: ApplicationView,
  mode: InterviewAnswerMode,
): Promise<InterviewSessionView> {
  return startInterviewSession({
    mode,
    applicationId: response.id,
    roleTitle: response.vacancy?.title ?? undefined,
    questionTypes: ['system_design'],
    replaceCompleted: true,
  });
}

export async function saveSchema(
  sessionId: string,
  questionId: string,
  schema: SchemaToSave,
): Promise<void> {
  const response = await apiFetch(questionPath(sessionId, questionId, 'schema'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema }),
  });
  await readDataObject<object>(response);
}

/**
 * «Закончить и разобрать»: ответ, исправленная схема, конец тренировки — чтобы
 * незаконченная тренировка не держала пробное интервью (I2).
 */
export async function finishPractice(input: {
  readonly session: InterviewSessionView;
  readonly questionId: string;
  readonly answer: string;
  readonly elapsedSeconds: number;
  readonly schema: SchemaToSave | null;
}): Promise<InterviewSessionView> {
  const answered = await submitInterviewAnswer(input.session.id, {
    expectedVersion: input.session.version,
    questionId: input.questionId,
    answer: input.answer.trim(),
    elapsedSeconds: input.elapsedSeconds,
    // Разбор строит отдельный вызов (POST review): отзыв к ответу никто не читает.
    feedback: false,
  });
  if (input.schema && input.schema.nodes.length > 0) {
    await saveSchema(answered.id, input.questionId, input.schema);
  }
  return answered.status === 'completed'
    ? answered
    : transitionInterviewSession(answered.id, answered.version, 'finish');
}

/** Разбор считается на сервере правилами по сохранённому ответу: при возврате — тот же. */
export async function reviewPractice(sessionId: string, questionId: string): Promise<PracticeReview> {
  const response = await apiFetch(questionPath(sessionId, questionId, 'review'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  return readDataObject<PracticeReview>(response);
}

export async function markHelpful(
  sessionId: string,
  questionId: string,
  helpful: boolean,
): Promise<boolean> {
  const response = await apiFetch(questionPath(sessionId, questionId, 'helpful'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ helpful }),
  });
  return (await readDataObject<{ helpful: boolean }>(response)).helpful;
}
