import { useEffect, useState } from 'react';
import type { VacancyTriage, VacancyTriageAnswers } from '../../../../../shared/b640Vacancies';
import { requestTriage, type TriageTarget } from '../triageApi';

export type TriageStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface TriageRequest {
  readonly status: TriageStatus;
  /** Последний полученный разбор: при новом запросе остаётся на экране до ответа. */
  readonly triage: VacancyTriage | null;
  readonly retry: () => void;
}

interface RequestState {
  readonly status: TriageStatus;
  readonly triage: VacancyTriage | null;
}

const IDLE: RequestState = { status: 'idle', triage: null };

/**
 * Разбор списка на сервере. Любая смена цели разбора или ответов отменяет прежний запрос, а ответ
 * отменённого запроса отбрасывается: старый разбор не перезапишет новый.
 */
export function useTriageRequest(
  active: boolean,
  paused: boolean,
  target: TriageTarget | null,
  answers: VacancyTriageAnswers,
): TriageRequest {
  const [state, setState] = useState<RequestState>(IDLE);
  const [attempt, setAttempt] = useState(0);
  const targetKey = JSON.stringify(target);
  const answersKey = JSON.stringify(answers);

  useEffect(() => {
    if (!active) {
      setState(IDLE);
      return undefined;
    }
    if (paused) return undefined;
    if (!target || ('clusterIds' in target && target.clusterIds.length === 0)) {
      setState({ status: 'ready', triage: null });
      return undefined;
    }
    const controller = new AbortController();
    setState((current) => ({ status: 'loading', triage: current.triage }));
    requestTriage(target, answers, controller.signal)
      .then((triage) => {
        if (!controller.signal.aborted) setState({ status: 'ready', triage });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState((current) => ({ status: 'failed', triage: current.triage }));
      });
    return () => controller.abort();
  }, [active, paused, targetKey, answersKey, attempt]);

  return { ...state, retry: () => setAttempt((value) => value + 1) };
}
