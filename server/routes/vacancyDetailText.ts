import { hasDetailText, hasStandInDescription } from '../vacancies/detailTextPriority';
import type { VacancyDescriptionLoadResult } from '../vacancies/multiSourceVacancyEngine';

/** Сколько карточка ждёт текст в самом запросе; дальше его дочитает воркер обслуживания. */
export const DETAIL_TEXT_WAIT_MS = 4_000;
/** Выше любой строки подборки: открытую карточку человек читает сейчас. */
const OPENED_CARD_RANK = -1;

interface DetailTextEngine {
  loadVacancyDescription(id: string): Promise<VacancyDescriptionLoadResult>;
  requestHhTextPriority?(ids: readonly string[], baseRank?: number): void;
}

export type DetailTextResult = VacancyDescriptionLoadResult & {
  readonly pending?: true;
  /** Описание записи — склейка списка, не текст вакансии. */
  readonly standIn?: true;
};

/**
 * B791 25.11: площадка без текста в списке — карточка в голову очереди дочитки. У LinkedIn вместо
 * описания склейка «название — компания — город»: до текста ответ `pending`, а не она.
 */
function requestListedText(
  engine: DetailTextEngine,
  vacancyId: string,
  loaded: VacancyDescriptionLoadResult | undefined,
): DetailTextResult {
  const result = loaded ?? { unavailable: true, status: 'failed' as const };
  if (!hasDetailText(vacancyId) || !result.vacancy || result.vacancy.fullDescription?.trim()) {
    return result;
  }
  try {
    engine.requestHhTextPriority?.([vacancyId], OPENED_CARD_RANK);
  } catch {
    // Занятая база не роняет карточку: запись дочитает общий обход, повтор — на следующем опросе.
  }
  return hasStandInDescription(vacancyId) ? { ...result, pending: true, standIn: true } : result;
}

/**
 * 02.11: an opened card without hh text waited behind the HTTP loader's page warm-ups (one
 * page a second, 40 queued) and then said «Краткого описания нет», though «Полное описание»
 * later got the text. Now the request waits a few seconds, then puts the card at the head of
 * the maintenance worker's text queue and answers `pending`; the card asks again.
 */
export async function loadDetailText(
  engine: DetailTextEngine,
  vacancyId: string,
  waitMs = DETAIL_TEXT_WAIT_MS,
): Promise<DetailTextResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), waitMs);
  });
  const loaded = await Promise.race([engine.loadVacancyDescription(vacancyId), late]);
  clearTimeout(timer);
  const waiting =
    vacancyId.startsWith('src-hh-search:') &&
    (!loaded || (loaded.status === 'failed' && loaded.blocked !== 'refused' && !loaded.restricted));
  if (!waiting) return requestListedText(engine, vacancyId, loaded);
  engine.requestHhTextPriority?.([vacancyId], OPENED_CARD_RANK);
  return { ...(loaded ?? {}), unavailable: true, status: 'failed', pending: true };
}
