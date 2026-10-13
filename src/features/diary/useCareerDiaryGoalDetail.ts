import { useCallback, useEffect, useRef, useState } from 'react';
import type { CareerDiaryGoalSummary, CareerDiaryMeasurement } from '../../../shared/careerDiary';
import { apiErrorMessage } from '../coach/apiClient';
import { getCareerDiaryGoal, listCareerDiaryMeasurements } from './careerDiaryApi';
import type { CareerDiaryLoadState } from './useCareerDiaryOverview';

const MEASUREMENTS_PAGE_SIZE = 20;

async function fetchGoalDetails(goalId: string, signal: AbortSignal) {
  const [goal, page] = await Promise.all([
    getCareerDiaryGoal(goalId, signal),
    listCareerDiaryMeasurements(goalId, { limit: MEASUREMENTS_PAGE_SIZE, signal }),
  ]);
  return { goal, page };
}

export function useCareerDiaryGoalDetail(goalId: string | null) {
  const [goal, setGoal] = useState<CareerDiaryGoalSummary | null>(null);
  const [measurements, setMeasurements] = useState<CareerDiaryMeasurement[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<CareerDiaryLoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const loadingMoreRef = useRef(false);
  const reload = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    if (!goalId) return undefined;
    const controller = new AbortController();
    setState('loading');
    setError(null);
    void fetchGoalDetails(goalId, controller.signal)
      .then(({ goal: nextGoal, page }) => {
        setGoal(nextGoal);
        setMeasurements([...page.items]);
        setNextCursor(page.nextCursor);
        setState('ready');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(apiErrorMessage(reason, 'Не удалось загрузить цель и её замеры.'));
        setState('error');
      });
    return () => controller.abort();
  }, [goalId, revision]);

  const loadMore = useCallback(async () => {
    if (!goalId || !nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await listCareerDiaryMeasurements(goalId, {
        limit: MEASUREMENTS_PAGE_SIZE,
        cursor: nextCursor,
      });
      setMeasurements((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Не удалось загрузить следующие замеры.'));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [goalId, nextCursor]);

  return { goal, measurements, nextCursor, state, error, loadingMore, loadMore, reload };
}
