import { useCallback, useEffect, useState } from 'react';
import { preferredApplySource } from '../../../../shared/hhVacancySource';
import { CoachApiError } from '../../coach/apiClient';
import type { MatchedVacancyItem } from '../../coach/cabinetTypes';
import { readCachedMatchedPool } from '../../vacancies/matchedPoolCache';
import { withDeadline } from '../../vacancies/vacancyRead';
import { getVacancyCard } from '../vacancies/b640Api';

type Cluster = MatchedVacancyItem['cluster'];

export type ApplyClusterState =
  | { readonly status: 'loading' | 'failed' }
  | { readonly status: 'ready'; readonly cluster: Cluster | null };

const GONE_CODES: ReadonlySet<string> = new Set(['vacancy_not_found', 'vacancy_gone']);
const LOADING: ApplyClusterState = { status: 'loading' };

function cachedCluster(vacancyId: string): Cluster | null {
  const pooled = readCachedMatchedPool()?.matched.find((item) => item.cluster.id === vacancyId);
  return pooled?.cluster ?? null;
}

/** В показанной подборке у вакансии уже есть hh.ru — площадка известна, запрос не нужен. */
function settledByCache(vacancyId: string): ApplyClusterState | null {
  const cluster = cachedCluster(vacancyId);
  return cluster && preferredApplySource(cluster).hh ? { status: 'ready', cluster } : null;
}

async function readCluster(vacancyId: string): Promise<ApplyClusterState> {
  try {
    const item = await withDeadline((signal) => getVacancyCard(vacancyId, signal));
    return { status: 'ready', cluster: item.cluster };
  } catch (reason) {
    const gone = reason instanceof CoachApiError && GONE_CODES.has(reason.code);
    return gone ? { status: 'ready', cluster: cachedCluster(vacancyId) } : { status: 'failed' };
  }
}

/**
 * Вакансия отклика для выбора площадки (B678): один запрос по id вместо всей подборки
 * страницами. Ответ окончательный — площадка после него не меняется. Другая вакансия —
 * другой экран (`key`), поэтому `vacancyId` за жизнь хука не меняется.
 */
export function useApplyCluster(vacancyId: string): {
  readonly state: ApplyClusterState;
  readonly retry: () => void;
} {
  const [state, setState] = useState<ApplyClusterState>(() => settledByCache(vacancyId) ?? LOADING);
  const loading = state.status === 'loading';

  useEffect(() => {
    if (!loading) return undefined;
    let alive = true;
    void readCluster(vacancyId).then((next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, [vacancyId, loading]);

  const retry = useCallback(() => setState(LOADING), []);
  return { state, retry };
}
