import { hasDetailText, hasStandInDescription } from '../vacancies/detailTextPriority';
import type { VacancyDescriptionLoadResult } from '../vacancies/multiSourceVacancyEngine';

/** Сколько карточка ждёт текст в самом запросе; дальше его дочитает воркер обслуживания. */
export const DETAIL_TEXT_WAIT_MS = 4_000;
/** Выше любой строки подборки: открытую карточку человек читает сейчас. */
const OPENED_CARD_RANK = -1;

/** Сколько карточка LinkedIn ждёт очередь воркера; короче опроса клиента (20 × 3 с). */
export const LISTED_TEXT_WAIT_MS = 45_000;
/** Пост снят или площадка отвечает 429: новое ожидание — не раньше часа, а не с каждым открытием. */
const LISTED_TEXT_AGAIN_MS = 60 * 60_000;
const firstAskedAt = new Map<string, number>();

/** Время ожидания текста конечно: дальше ответ — «текста нет», без скелета. */
function stillWaiting(vacancyId: string, nowMs: number): boolean {
  for (const [id, askedAt] of firstAskedAt) {
    if (nowMs - askedAt < LISTED_TEXT_AGAIN_MS) break;
    firstAskedAt.delete(id);
  }
  const askedAt = firstAskedAt.get(vacancyId);
  if (askedAt === undefined) firstAskedAt.set(vacancyId, nowMs);
  return askedAt === undefined || nowMs - askedAt < LISTED_TEXT_WAIT_MS;
}

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
 * описания склейка «название — компания — город»: она не отдаётся,
 * а пока воркер может успеть, ответ `pending`.
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
  if (!hasStandInDescription(vacancyId)) return result;
  const pending = stillWaiting(vacancyId, Date.now());
  return { ...result, ...(pending ? { pending: true as const } : {}), standIn: true };
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
