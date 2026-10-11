import { useInterviewSessionOperationRunner } from './useInterviewSessionOperationRunner';
import { useInterviewSessionMutations } from './useInterviewSessionMutations';
import { useMockInterviewSessionLoader } from './useMockInterviewSessionLoader';

export function useMockInterviewSession() {
  const loader = useMockInterviewSessionLoader();
  const operations = useInterviewSessionOperationRunner(loader.setSession);
  const mutations = useInterviewSessionMutations(loader.session, operations.run);

  return {
    loadState: loader.loadState,
    loadError: loader.loadError,
    session: loader.session,
    starStories: loader.starStories,
    starStoriesError: loader.starStoriesError,
    operation: operations.operation,
    error: operations.error,
    failedOperation: operations.failedOperation,
    clearError: operations.clearError,
    retryLoad: loader.retryLoad,
    ...mutations,
  };
}

export type MockInterviewSessionState = ReturnType<typeof useMockInterviewSession>;
