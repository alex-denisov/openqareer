import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { InterviewSessionView } from './interviewSimulatorApi';
import type {
  InterviewOperation,
  InterviewSessionOperationResult,
  InterviewUiError,
  SessionOperationRunner,
} from './mockInterviewSessionTypes';
import { toInterviewUiError } from './mockInterviewSessionUtils';

export interface InterviewSessionOperationState {
  readonly operation: InterviewOperation;
  readonly error: InterviewUiError | null;
  readonly failedOperation: InterviewOperation;
  readonly clearError: () => void;
  readonly run: SessionOperationRunner;
}

export function useInterviewSessionOperationRunner(
  setSession: Dispatch<SetStateAction<InterviewSessionView | null>>,
): InterviewSessionOperationState {
  const [operation, setOperation] = useState<InterviewOperation>(null);
  const [error, setError] = useState<InterviewUiError | null>(null);
  const [failedOperation, setFailedOperation] = useState<InterviewOperation>(null);

  const run = useCallback<SessionOperationRunner>(async (kind, request, fallback): Promise<InterviewSessionOperationResult> => {
    setOperation(kind);
    setError(null);
    setFailedOperation(null);
    try {
      const updated = await request();
      setSession(updated);
      return { session: updated, error: null };
    } catch (reason) {
      const operationError = toInterviewUiError(reason, fallback);
      setError(operationError);
      setFailedOperation(kind);
      return { session: null, error: operationError };
    } finally {
      setOperation(null);
    }
  }, [setSession]);

  const clearError = useCallback(() => setError(null), []);
  return { operation, error, failedOperation, clearError, run };
}
