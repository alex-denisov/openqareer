import type {
  InterviewSessionView,
  InterviewTransition,
  StartInterviewInput,
} from './interviewSimulatorApi';

export type InterviewOperation = 'start' | 'answer' | 'transition' | null;
export type InterviewLoadState = 'loading' | 'ready' | 'error';

export interface InterviewUiError {
  readonly code?: string;
  readonly message: string;
}

export interface InterviewSessionOperationResult {
  readonly session: InterviewSessionView | null;
  readonly error: InterviewUiError | null;
}

export type SessionOperationRunner = (
  kind: Exclude<InterviewOperation, null>,
  request: () => Promise<InterviewSessionView>,
  fallback: string,
) => Promise<InterviewSessionOperationResult>;

export type SessionTransition = (action: InterviewTransition) => Promise<InterviewSessionOperationResult>;
export type SessionStarter = (input: StartInterviewInput) => Promise<InterviewSessionOperationResult>;
