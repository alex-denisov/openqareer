import { useEffect, useState } from 'react';
import { getVacancyConnectionCircles, type VacancyConnectionCircles } from './vacancyLetterApi';

export type VacancyPathCirclesState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly retry: () => void }
  | { readonly status: 'ready'; readonly data: VacancyConnectionCircles };

/** Loads the vacancy's three connection circles only while the path is open. */
export function useVacancyPathCircles(
  vacancyId: string,
  enabled: boolean,
): VacancyPathCirclesState {
  const [loaded, setLoaded] = useState<{ id: string; data: VacancyConnectionCircles }>();
  const [failedId, setFailedId] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || loaded?.id === vacancyId) return;
    let active = true;
    setFailedId(undefined);
    getVacancyConnectionCircles(vacancyId)
      .then((data) => {
        if (active) setLoaded({ id: vacancyId, data });
      })
      .catch(() => {
        if (active) setFailedId(vacancyId);
      });
    return () => {
      active = false;
    };
  }, [enabled, vacancyId, attempt, loaded?.id]);

  if (loaded?.id === vacancyId) return { status: 'ready', data: loaded.data };
  if (failedId === vacancyId) return { status: 'error', retry: () => setAttempt((n) => n + 1) };
  return { status: 'loading' };
}
