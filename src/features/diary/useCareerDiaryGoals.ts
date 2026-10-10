import { useCallback, useEffect, useRef, useState } from 'react';
import type { CareerDiaryGoalSummary } from '../../../shared/careerDiary';
import { apiErrorMessage } from '../coach/apiClient';
import { listCareerDiaryGoals } from './careerDiaryApi';
import type { CareerDiaryLoadState } from './useCareerDiaryOverview';

const GOALS_PAGE_SIZE = 20;

export function useCareerDiaryGoals() {
  const [goals, setGoals] = useState<CareerDiaryGoalSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<CareerDiaryLoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const loadingMoreRef = useRef(false);
  const reload = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    setError(null);
    void listCareerDiaryGoals({ limit: GOALS_PAGE_SIZE, signal: controller.signal })
      .then((page) => {
        setGoals([...page.items]);
        setNextCursor(page.nextCursor);
        setState('ready');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(apiErrorMessage(reason, 'Не удалось загрузить цели.'));
        setState('error');
      });
    return () => controller.abort();
  }, [revision]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await listCareerDiaryGoals({ limit: GOALS_PAGE_SIZE, cursor: nextCursor });
      setGoals((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setLoadMoreError(apiErrorMessage(reason, 'Не удалось загрузить следующие цели.'));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [nextCursor]);

  return { goals, nextCursor, state, error, loadMoreError, loadingMore, loadMore, reload };
}
