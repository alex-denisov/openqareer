import { apiFetch, readDataObject } from '../coach/apiClient';

export type InterviewAnswerMode = 'text' | 'voice';
export type InterviewQuestionType = 'behavioral' | 'system_design';
export type InterviewSessionStatus = 'active' | 'paused' | 'interrupted' | 'completed';
export type InterviewTransition = 'next' | 'skip' | 'pause' | 'resume' | 'interrupt' | 'finish';

export interface InterviewEvaluation {
  readonly rubric: 'star' | 'system_design';
  readonly criteria: Readonly<Record<string, { readonly points: 0 | 1 | 2; readonly reason: string }>>;
  readonly points: number;
  readonly maxPoints: number;
  readonly feedback?: string;
}

export interface InterviewQuestionView {
  readonly id: string;
  readonly type: InterviewQuestionType;
  readonly topic: string;
  readonly prompt: string;
  readonly storyId: string | null;
  readonly storyTitle: string | null;
  readonly sourceFactIds: readonly string[];
  readonly skipped: boolean;
  readonly answer?: {
    readonly text: string;
    readonly elapsedSeconds: number;
    readonly evaluation: InterviewEvaluation;
  };
}

export interface InterviewSessionView {
  readonly id: string;
  readonly version: number;
  readonly status: InterviewSessionStatus;
  readonly mode: InterviewAnswerMode;
  readonly roleTitle: string;
  readonly applicationId: string | null;
  readonly vacancyTitle: string | null;
  readonly questionTypes: readonly InterviewQuestionType[];
  readonly stressMode: boolean;
  readonly questions: readonly InterviewQuestionView[];
  readonly currentQuestionIndex: number;
  readonly currentQuestion: InterviewQuestionView | null;
  readonly topicSummary: readonly {
    readonly topic: string;
    readonly answered: number;
    readonly points: number;
    readonly maxPoints: number;
  }[];
  readonly startedAt: string;
  readonly updatedAt: string;
}

export interface StartInterviewInput {
  readonly mode: InterviewAnswerMode;
  readonly roleTitle?: string;
  readonly applicationId?: string;
  readonly questionTypes?: readonly InterviewQuestionType[];
  readonly stressMode?: boolean;
  readonly replaceCompleted?: boolean;
}

const INTERVIEW_URL = '/api/v1/candidate/interview-sessions';

export async function getCurrentInterviewSession(
  signal?: AbortSignal,
): Promise<InterviewSessionView | null> {
  const response = await apiFetch(`${INTERVIEW_URL}/current`, { signal });
  const data = await readDataObject<{ session: InterviewSessionView | null }>(response);
  return data.session;
}

export async function getInterviewSession(id: string): Promise<InterviewSessionView> {
  const response = await apiFetch(`${INTERVIEW_URL}/${encodeURIComponent(id)}`);
  const data = await readDataObject<{ session: InterviewSessionView }>(response);
  return data.session;
}

export async function startInterviewSession(input: StartInterviewInput): Promise<InterviewSessionView> {
  const response = await apiFetch(INTERVIEW_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await readDataObject<{ session: InterviewSessionView }>(response);
  return data.session;
}

export async function transitionInterviewSession(
  id: string,
  expectedVersion: number,
  action: InterviewTransition,
): Promise<InterviewSessionView> {
  const response = await apiFetch(`${INTERVIEW_URL}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion, action }),
  });
  const data = await readDataObject<{ session: InterviewSessionView }>(response);
  return data.session;
}

export async function submitInterviewAnswer(
  id: string,
  input: {
    readonly expectedVersion: number;
    readonly questionId: string;
    readonly answer: string;
    readonly elapsedSeconds: number;
    readonly replaceAnswer?: boolean;
  },
): Promise<InterviewSessionView> {
  const response = await apiFetch(`${INTERVIEW_URL}/${encodeURIComponent(id)}/answers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await readDataObject<{ session: InterviewSessionView }>(response);
  return data.session;
}
