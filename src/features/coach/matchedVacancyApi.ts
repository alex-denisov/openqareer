import type { MatchedVacancyItem } from './cabinetTypes';
import { CoachApiError as CoachApiErrorClass, apiFetch, throwApiError } from './apiClient';

/**
 * Чтение подбора живёт отдельно от общего API кабинета.
 *
 * Подбор — единственный ответ, который не помещается в один запрос: он едет
 * страницами внутри байтового бюджета (INC-029) и по плану смещений (B211).
 * Держать этот разговор рядом с однократными вызовами кабинета значило бы
 * растить `coachApi.ts` за его же потолок в 800 строк.
 */

export interface MatchedVacancyPage {
  readonly items: MatchedVacancyItem[];
  readonly total: number;
  readonly nextOffset: number | null;
  /** Смещения всех страниц пула — приходят только с первой (B211). */
  readonly pageOffsets?: readonly number[];
}

/**
 * Подбор приходит страницами: целиком тело в 776 КБ до браузера не доезжало —
 * маршрут обрывал ответ примерно на 20 КБ, и экран ждал его вечно (INC-029).
 */
export async function getMatchedVacancyPage(
  offset = 0,
  signal?: AbortSignal,
): Promise<MatchedVacancyPage> {
  const response = await apiFetch(
    `/api/v1/candidate/matched-vacancies?offset=${encodeURIComponent(String(offset))}`,
    { signal },
  );
  if (!response.ok) {
    await throwApiError(response);
  }
  const envelope = (await response.json()) as {
    data?: unknown;
    meta?: { total?: unknown; nextOffset?: unknown; pageOffsets?: unknown };
  };
  if (!Array.isArray(envelope.data)) {
    throw new CoachApiErrorClass('Ответ сервиса не разобран.', 'malformed_response', false);
  }
  const items = envelope.data as MatchedVacancyItem[];
  const total = typeof envelope.meta?.total === 'number' ? envelope.meta.total : items.length;
  const nextOffset =
    typeof envelope.meta?.nextOffset === 'number' ? envelope.meta.nextOffset : null;
  // План чтения — это список чисел или ничего: чужой тип на его месте не
  // становится смещениями, иначе чтение попросит страницу по мусору (B211).
  const planned = envelope.meta?.pageOffsets;
  const pageOffsets =
    Array.isArray(planned) && planned.every((entry) => typeof entry === 'number')
      ? (planned as number[])
      : undefined;
  return { items, total, nextOffset, ...(pageOffsets ? { pageOffsets } : {}) };
}

export async function getMatchedVacancies(signal?: AbortSignal): Promise<MatchedVacancyItem[]> {
  const page = await getMatchedVacancyPage(0, signal);
  return page.items;
}
