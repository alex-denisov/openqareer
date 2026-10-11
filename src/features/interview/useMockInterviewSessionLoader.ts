import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { apiErrorMessage } from '../coach/apiClient';
import { getCurrentInterviewSession } from './interviewSimulatorApi';
import { getStarStories } from './starStoriesApi';
import type { InterviewLoadState, InterviewUiError } from './mockInterviewSessionTypes';
import type { InterviewSessionView } from './interviewSimulatorApi';
import type { StarStoriesSnapshot } from '../../../shared/starStories';
import { toInterviewUiError } from './mockInterviewSessionUtils';

export interface MockInterviewSessionLoader {
  readonly loadState: InterviewLoadState;
  readonly loadError: InterviewUiError | null;
  readonly session: InterviewSessionView | null;
  readonly setSession: Dispatch<SetStateAction<InterviewSessionView | null>>;
  readonly starStories: StarStoriesSnapshot | null;
  readonly starStoriesError: string | null;
  readonly retryLoad: () => void;
}

interface LoadResult {
  readonly session: InterviewSessionView | null;
  readonly starStories: StarStoriesSnapshot | null;
  readonly starStoriesError: string | null;
}

async function loadInterviewData(signal: AbortSignal): Promise<LoadResult> {
  const [sessionResult, storiesResult] = await Promise.allSettled([
    getCurrentInterviewSession(signal),
    getStarStories(signal),
  ]);
  if (sessionResult.status === 'rejected') throw sessionResult.reason;
  return {
    session: sessionResult.value,
    starStories: storiesResult.status === 'fulfilled' ? storiesResult.value : null,
    starStoriesError: storiesResult.status === 'rejected'
      ? apiErrorMessage(storiesResult.reason, 'STAR-истории не загрузились.')
      : null,
  };
}

export function useMockInterviewSessionLoader(): MockInterviewSessionLoader {
  const [reloadVersion, setReloadVersion] = useState(0);
  const [loadState, setLoadState] = useState<InterviewLoadState>('loading');
  const [session, setSession] = useState<InterviewSessionView | null>(null);
  const [starStories, setStarStories] = useState<StarStoriesSnapshot | null>(null);
  const [starStoriesError, setStarStoriesError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<InterviewUiError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoadState('loading');
    setLoadError(null);
    void loadInterviewData(controller.signal)
      .then((result) => {
        if (!active) return;
        setSession(result.session);
        setStarStories(result.starStories);
        setStarStoriesError(result.starStoriesError);
        setLoadState('ready');
      })
      .catch((reason: unknown) => {
        if (!active || controller.signal.aborted) return;
        setLoadError(toInterviewUiError(reason, 'Тренировку не удалось загрузить.'));
        setLoadState('error');
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadVersion]);

  const retryLoad = useCallback(() => setReloadVersion((value) => value + 1), []);
  return { loadState, loadError, session, setSession, starStories, starStoriesError, retryLoad };
}
