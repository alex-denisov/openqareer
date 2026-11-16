import { useCallback, useEffect, useState } from 'react';
import type { VacancyFitView } from '../../../../../shared/vacancyFit';
import { readVacancyFit, requestVacancyFit } from '../../../vacancies/vacancyFitApi';

const POLL_MS = 4_000;
const MAX_POLLS = 30;
const COUNTING: readonly VacancyFitView['state'][] = ['processing', 'retrying', 'refreshing'];

export interface VacancyFitState {
  readonly view: VacancyFitView | undefined;
  /** Чтение или постановка в очередь не удались. */
  readonly failed: boolean;
  readonly retry: () => void;
}

/** Читает разбор совпадения; пока считается — перечитывает; «Повторить» ставит расчёт заново. */
export function useVacancyFit(vacancyId: string): VacancyFitState {
  const [view, setView] = useState<VacancyFitView>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const forced = attempt > 0;
    setFailed(false);
    if (forced) setView(undefined);

    const settle = async (polls: number, queued: boolean): Promise<void> => {
      let next = await readVacancyFit(vacancyId);
      const stale = next.state === 'not_requested' || (forced && next.state === 'failed');
      if (stale && !queued) next = await requestVacancyFit(vacancyId);
      if (!alive) return;
      setView(next);
      const waiting = COUNTING.includes(next.state) || (stale && !queued);
      if (waiting && polls < MAX_POLLS) {
        timer = setTimeout(() => void run(polls + 1, true), POLL_MS);
      }
    };
    const run = (polls: number, queued: boolean): Promise<void> =>
      settle(polls, queued).catch(() => {
        if (alive) setFailed(true);
      });

    void run(0, false);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [vacancyId, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { view, failed, retry };
}
