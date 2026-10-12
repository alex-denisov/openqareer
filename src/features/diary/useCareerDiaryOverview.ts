import { useCallback, useEffect, useState } from 'react';
import type { CareerDiaryOverview } from '../../../shared/careerDiary';
import { apiErrorMessage } from '../coach/apiClient';
import { getCareerDiaryOverview } from './careerDiaryApi';

export type CareerDiaryLoadState = 'loading' | 'ready' | 'error';

export function useCareerDiaryOverview() {
  const [overview, setOverview] = useState<CareerDiaryOverview | null>(null);
  const [state, setState] = useState<CareerDiaryLoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    setError(null);
    void getCareerDiaryOverview(controller.signal)
      .then((value) => {
        setOverview(value);
        setState('ready');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(apiErrorMessage(reason, 'Не удалось загрузить сводку дневника.'));
        setState('error');
      });
    return () => controller.abort();
  }, [revision]);

  return { overview, state, error, reload };
}
