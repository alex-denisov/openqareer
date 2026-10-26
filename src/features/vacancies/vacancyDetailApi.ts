import { useEffect, useState } from 'react';
import { apiFetch, readData } from '../coach/apiClient';
import { decodeVacancyText } from './vacancyText';

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
  return {
    ...detail,
    description: decodeVacancyText(detail.description ?? ''),
    ...(detail.summary ? { summary: decodeVacancyText(detail.summary) } : {}),
  };
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
  const fromPage = decodeVacancyText(pageSummary).trim();
  if (fromPage) return { text: fromPage };
  if (detail.status === 'loading' || detail.status === 'idle') return { loading: true };
  if (detail.status !== 'ready') return {};
  if (detail.detail.summary?.trim()) return { text: detail.detail.summary.trim() };
  const opening = openingOfDescription(detail.detail.description);
  return opening ? { text: opening } : {};
}

/** Абзац короче — заголовок раздела или служебная строка («Job Requisition ID #»), не текст. */
const MIN_PARAGRAPH_LENGTH = 60;
const OPENING_TARGET_LENGTH = 280;
const OPENING_MAX_LENGTH = 420;

/**
 * Выжимки нет ни у страницы, ни у кластера, а полный текст есть — карточка
 * показывает его начало, а не «Краткого описания нет» (26.10, Autodesk).
 */
export function openingOfDescription(description: string): string | undefined {
  const paragraphs = description
    .split(/\n\s*\n|\n/u)
    .map((part) => part.replace(/\s+/gu, ' ').trim())
    .filter((part) => part.length >= MIN_PARAGRAPH_LENGTH);
  let opening = '';
  for (const paragraph of paragraphs) {
    if (opening.length >= OPENING_TARGET_LENGTH) break;
    opening = opening ? `${opening} ${paragraph}` : paragraph;
  }
  if (!opening) return undefined;
  if (opening.length <= OPENING_MAX_LENGTH) return opening;
  const cut = opening.slice(0, OPENING_MAX_LENGTH - 1);
  const sentenceEnd = cut.lastIndexOf('. ');
  return sentenceEnd >= OPENING_TARGET_LENGTH / 2
    ? cut.slice(0, sentenceEnd + 1)
    : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

/** B446-g4: раскрытая карточка дочитывает выжимку вместе с деталями, если страница её не принесла. */
export function useVacancySummary(clusterId: string, pageSummary: string): VacancySummaryText {
  const detail = useVacancyDetail(clusterId, !pageSummary.trim());
  return vacancySummaryText(pageSummary, detail);
}
