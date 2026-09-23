import type { AdminVacancySource } from './adminApi';

/**
 * B207 — состояние списка площадок в суперадминке.
 *
 * До этого экран держал только `sources` и `loading`, а любая ошибка загрузки
 * глушилась пустым `catch`. Из-за этого провал маршрута — `401`, `429`, `500`,
 * обрыв сети — выглядел ровно так же, как честный ответ «источников нет»:
 * администратор видел пустую сетку и не знал, что запрос вообще не дошёл.
 *
 * Форма повторяет `DirectoryState` из того же экрана: отказ обязан быть назван,
 * а не забыт (B161).
 */
export type VacancySourcesState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly sources: readonly AdminVacancySource[]; readonly complete: boolean }
  | { readonly status: 'failed'; readonly message: string };

/** Что говорит экран, когда причина отказа нечитаема. */
const UNREADABLE_FAILURE = 'Не удалось загрузить список площадок.';

export function sourcesLoading(): VacancySourcesState {
  return { status: 'loading' };
}

export function sourcesLoaded(
  sources: readonly AdminVacancySource[],
  complete = true,
): VacancySourcesState {
  return { status: 'ready', sources, complete };
}

/**
 * Превращает причину в состояние отказа — либо сообщает, что показывать нечего.
 *
 * Отменённый запрос отказом не является: экран сам обрывает свою же загрузку
 * при размонтировании, и это не событие сервера. Показать администратору такой
 * обрыв значило бы обвинить продукт в том, чего он не делал.
 */
export function sourcesFailure(reason: unknown): VacancySourcesState | null {
  if (isAbort(reason)) return null;
  const message =
    reason instanceof Error && reason.message.trim() ? reason.message : UNREADABLE_FAILURE;
  return { status: 'failed', message };
}

function isAbort(reason: unknown): boolean {
  if (typeof DOMException !== 'undefined' && reason instanceof DOMException) {
    return reason.name === 'AbortError';
  }
  return reason instanceof Error && reason.name === 'AbortError';
}
