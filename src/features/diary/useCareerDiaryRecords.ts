import { useCallback, useEffect, useRef, useState } from 'react';
import type { CareerDiaryAchievement, CareerDiaryWeeklyReview } from '../../../shared/careerDiary';
import { apiErrorMessage } from '../coach/apiClient';
import { listCareerDiaryAchievements, listCareerDiaryReviews } from './careerDiaryApi';
import type { CareerDiaryLoadState } from './useCareerDiaryOverview';

export type CareerDiaryTab = 'goals' | 'reviews' | 'achievements';
export type CareerDiaryRecord = CareerDiaryWeeklyReview | CareerDiaryAchievement;

const RECORDS_PAGE_SIZE = 20;

export function useCareerDiaryRecords(tab: CareerDiaryTab) {
  const [records, setRecords] = useState<CareerDiaryRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<CareerDiaryLoadState>('ready');
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const loadingMoreRef = useRef(false);
  const reload = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    if (tab === 'goals') return undefined;
    const controller = new AbortController();
    setState('loading');
    setError(null);
    const request = tab === 'reviews'
      ? listCareerDiaryReviews({ limit: RECORDS_PAGE_SIZE, signal: controller.signal })
      : listCareerDiaryAchievements({ limit: RECORDS_PAGE_SIZE, signal: controller.signal });
    void request
      .then((page) => {
        setRecords([...page.items]);
        setNextCursor(page.nextCursor);
        setState('ready');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(apiErrorMessage(reason, 'Не удалось загрузить записи дневника.'));
        setState('error');
      });
    return () => controller.abort();
  }, [revision, tab]);

  const loadMore = useCallback(async () => {
    if (tab === 'goals' || !nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const input = { limit: RECORDS_PAGE_SIZE, cursor: nextCursor };
      const page = tab === 'reviews'
        ? await listCareerDiaryReviews(input)
        : await listCareerDiaryAchievements(input);
      setRecords((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Не удалось загрузить следующие записи.'));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [nextCursor, tab]);

  return { records, nextCursor, state, error, loadingMore, loadMore, reload };
}
