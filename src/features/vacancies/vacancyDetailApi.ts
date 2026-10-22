import { useEffect, useState } from 'react';
import { apiFetch, readData } from '../coach/apiClient';

export interface VacancyDetailText {
  readonly id: string;
  readonly description: string;
  readonly truncated: boolean;
  readonly skills: readonly string[];
  readonly responsibilities: readonly string[];
  /** Выжимка кластера: страница подборки её обрезает ради веса (B446-g4). */
  readonly summary?: string;
}

/** Full vacancy text for «Подробнее»; the matched list carries none (B266). */
export async function fetchVacancyDetail(clusterId: string): Promise<VacancyDetailText> {
  const response = await apiFetch(
    `/api/v1/candidate/vacancies/${encodeURIComponent(clusterId)}/detail`,
  );
  const detail = await readData<VacancyDetailText | null>(response);
  // Пустой ответ — это «не загрузилось», а не карточка без полей (B510).
  if (!detail) throw new Error('Vacancy detail is empty');
  return detail;
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

export interface VacancySummaryText {
  readonly text?: string;
  readonly loading?: boolean;
}

/** Краткое описание карточки: из страницы, иначе из деталей; пока грузится — честно «загружаем». */
export function vacancySummaryText(
  pageSummary: string,
  detail: VacancyDetailState,
): VacancySummaryText {
  const fromPage = pageSummary.trim();
  if (fromPage) return { text: fromPage };
  if (detail.status === 'loading' || detail.status === 'idle') return { loading: true };
  if (detail.status === 'ready' && detail.detail.summary?.trim())
    return { text: detail.detail.summary.trim() };
  return {};
}

/** B446-g4: раскрытая карточка дочитывает выжимку вместе с деталями, если страница её не принесла. */
export function useVacancySummary(clusterId: string, pageSummary: string): VacancySummaryText {
  const detail = useVacancyDetail(clusterId, !pageSummary.trim());
  return vacancySummaryText(pageSummary, detail);
}
