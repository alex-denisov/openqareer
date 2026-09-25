import { useEffect, useState } from 'react';
import { apiFetch, readData } from '../coach/apiClient';

export interface VacancyDetailText {
  readonly id: string;
  readonly description: string;
  readonly truncated: boolean;
  readonly skills: readonly string[];
  readonly responsibilities: readonly string[];
}

/** Full vacancy text for «Подробнее»; the matched list carries none (B266). */
export async function fetchVacancyDetail(clusterId: string): Promise<VacancyDetailText> {
  const response = await apiFetch(
    `/api/v1/candidate/vacancies/${encodeURIComponent(clusterId)}/detail`,
  );
  return readData<VacancyDetailText>(response);
}

export type VacancyDetailState =
  | { readonly status: 'idle' | 'loading' | 'failed' }
  | { readonly status: 'ready'; readonly detail: VacancyDetailText };

export function useVacancyDetail(clusterId: string, enabled: boolean): VacancyDetailState {
  const [state, setState] = useState<VacancyDetailState>({ status: 'idle' });
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    setState({ status: 'loading' });
    fetchVacancyDetail(clusterId)
      .then((detail) => alive && setState({ status: 'ready', detail }))
      .catch(() => alive && setState({ status: 'failed' }));
    return () => {
      alive = false;
    };
  }, [clusterId, enabled]);
  return state;
}
