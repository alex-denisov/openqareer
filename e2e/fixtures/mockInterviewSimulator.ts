import type { Page, Route } from '@playwright/test';
import type { InterviewSessionView } from '../../src/features/interview/interviewSimulatorApi';
import {
  createInterviewSession,
  INTERVIEW_QUESTION_COUNT,
  recordInterviewAnswer,
  scoreInterviewAnswer,
  summarizeInterviewTopics,
  transitionInterviewSession,
  type InterviewAction,
  type InterviewAnswerMode,
  type InterviewQuestionType,
  type InterviewSession,
} from '../../server/domain/interviewSimulator';

interface InterviewFixtureResponse {
  readonly data?: unknown;
  readonly status?: number;
  readonly error?: { readonly code: string; readonly message: string };
}

const BASE = '/api/v1/candidate/interview-sessions';
const QUESTION_TYPES = ['behavioral', 'system_design'] as const;
const ACTIONS: readonly InterviewAction[] = [
  'next',
  'skip',
  'pause',
  'resume',
  'interrupt',
  'finish',
];
const now = '2026-10-11T08:00:00.000Z';

function failure(code: string, message: string, status = 400): InterviewFixtureResponse {
  return { status, error: { code, message } };
}

function sessionView(session: InterviewSession): InterviewSessionView {
  return {
    ...session,
    currentQuestion: session.questions[session.currentQuestionIndex] ?? null,
    topicSummary: summarizeInterviewTopics(session),
  };
}

function sessionResponse(session: InterviewSession, status = 200): InterviewFixtureResponse {
  return { status, data: { session: sessionView(session) } };
}

function parseQuestionTypes(value: unknown): InterviewQuestionType[] | null {
  if (value === undefined) return [...QUESTION_TYPES];
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > QUESTION_TYPES.length ||
    value.some((type) => !QUESTION_TYPES.includes(type as InterviewQuestionType)) ||
    new Set(value).size !== value.length
  ) {
    return null;
  }
  return value as InterviewQuestionType[];
}

function sessionIdFromPath(path: string, suffix: string): string | null {
  if (!path.startsWith(`${BASE}/`) || !path.endsWith(suffix)) return null;
  const value = path.slice(BASE.length + 1, path.length - suffix.length);
  if (!value || value.includes('/')) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function createSession(
  body: Record<string, unknown>,
  current: InterviewSession | null,
):
  | { readonly session: InterviewSession; readonly error?: never }
  | { readonly session?: never; readonly error: InterviewFixtureResponse } {
  if (current && !['completed', 'interrupted'].includes(current.status)) {
    return {
      error: failure(
        'interview_session_active',
        'Продолжите или остановите текущую тренировку.',
        409,
      ),
    };
  }
  if (current && body.replaceCompleted !== true) {
    return {
      error: failure(
        'interview_restart_confirmation_required',
        'Подтвердите начало новой тренировки.',
        409,
      ),
    };
  }
  const roleTitle = typeof body.roleTitle === 'string' ? body.roleTitle.trim() : '';
  const questionTypes = parseQuestionTypes(body.questionTypes);
  const mode = body.mode ?? 'text';
  if (
    !roleTitle ||
    roleTitle.length > 180 ||
    !questionTypes ||
    (mode !== 'text' && mode !== 'voice')
  ) {
    return { error: failure('invalid_interview_start', 'Проверьте параметры тренировки.') };
  }
  const session = createInterviewSession({
    id: 'mock-interview-1',
    mode: mode as InterviewAnswerMode,
    roleTitle,
    applicationId: typeof body.applicationId === 'string' ? body.applicationId : null,
    questionTypes,
    stressMode: body.stressMode === true,
    stories: [],
    verifiedSkills: [],
    questionIds: Array.from(
      { length: INTERVIEW_QUESTION_COUNT },
      (_, index) => `mock-question-${index + 1}`,
    ),
    now,
  });
  return { session };
}

type AnswerResult =
  | { readonly session: InterviewSession; readonly error?: never }
  | { readonly session?: never; readonly error: InterviewFixtureResponse };

function answerSession(session: InterviewSession, body: Record<string, unknown>): AnswerResult {
  if (body.expectedVersion !== session.version) {
    return {
      error: failure(
        'interview_version_conflict',
        'Тренировка уже изменилась. Обновите экран.',
        409,
      ),
    };
  }
  const question = session.questions[session.currentQuestionIndex];
  if (session.status !== 'active' || !question || question.id !== body.questionId) {
    return { error: failure('interview_question_changed', 'Откройте текущий вопрос.', 409) };
  }
  if (question.answer && body.replaceAnswer !== true) {
    return { error: failure('interview_answer_exists', 'Ответ уже записан.', 409) };
  }
  const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
  const elapsedSeconds = body.elapsedSeconds;
  if (
    !answer ||
    !Number.isInteger(elapsedSeconds) ||
    Number(elapsedSeconds) < 0 ||
    Number(elapsedSeconds) > 3_600
  ) {
    return { error: failure('invalid_interview_answer', 'Проверьте ответ и время ответа.') };
  }
  const evaluation = {
    ...scoreInterviewAnswer(answer, question.type),
    feedback: 'Добавьте, как измерили результат.',
  };
  return {
    session: recordInterviewAnswer(session, answer, Number(elapsedSeconds), evaluation, now),
  };
}

export function createMockInterviewSimulatorFixture() {
  let session: InterviewSession | null = null;

  return {
    handle(
      path: string,
      method: string,
      body: Record<string, unknown>,
    ): InterviewFixtureResponse | null {
      if (path === `${BASE}/current` && method === 'GET') {
        return { status: 200, data: { session: session ? sessionView(session) : null } };
      }
      if (path === BASE && method === 'POST') {
        const created = createSession(body, session);
        if (created.error) return created.error;
        session = created.session;
        return sessionResponse(session, 201);
      }
      if (path === `${BASE}/current`) return null;

      const answerId = method === 'POST' ? sessionIdFromPath(path, '/answers') : null;
      if (answerId) {
        if (!session || session.id !== answerId) {
          return failure('interview_session_not_found', 'Тренировка не найдена.', 404);
        }
        const result = answerSession(session, body);
        if (result.error) return result.error;
        session = result.session;
        return sessionResponse(session);
      }
      const id = sessionIdFromPath(path, '');
      if (!id) return null;
      if (method === 'GET') {
        return session?.id === id
          ? sessionResponse(session)
          : failure('interview_session_not_found', 'Тренировка не найдена.', 404);
      }
      if (method !== 'PATCH') return null;
      if (!session || session.id !== id) {
        return failure('interview_session_not_found', 'Тренировка не найдена.', 404);
      }
      if (body.expectedVersion !== session.version) {
        return failure(
          'interview_version_conflict',
          'Тренировка уже изменилась. Обновите экран.',
          409,
        );
      }
      if (typeof body.action !== 'string' || !ACTIONS.includes(body.action as InterviewAction)) {
        return failure('invalid_interview_transition', 'Проверьте действие тренировки.');
      }
      try {
        session = transitionInterviewSession(session, body.action as InterviewAction, now);
        return sessionResponse(session);
      } catch (error) {
        const code = error instanceof Error ? error.message : 'interview_transition_invalid';
        return failure(code, 'Это действие недоступно для текущего вопроса.', 409);
      }
    },
  };
}

function requestBody(route: Route): Record<string, unknown> {
  try {
    return route.request().postDataJSON() as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function mockInterviewSimulatorRoutes(page: Page): Promise<void> {
  const fixture = createMockInterviewSimulatorFixture();
  await page.route(
    (url) => url.pathname === BASE || url.pathname.startsWith(`${BASE}/`),
    async (route) => {
      const url = new URL(route.request().url());
      const response = fixture.handle(url.pathname, route.request().method(), requestBody(route));
      if (!response) return route.fallback();
      if (response.error) {
        return route.fulfill({
          status: response.status ?? 400,
          json: { error: response.error },
        });
      }
      return route.fulfill({ status: response.status ?? 200, json: { data: response.data } });
    },
  );
}
