/**
 * Чтение, начатое заранее и отданное первому, кто попросит: экран n02 запускает чтения
 * вложенных групп вместе со своим, а не после него (было ≈1 с лишнего круга на открытии).
 * Невостребованное снимается при уходе с экрана — устаревшее не всплывёт позже.
 */
export interface Prefetch<T> {
  /** Начать чтение сейчас (повторный вызов не начинает второе). */
  readonly start: () => void;
  /** Взять начатое чтение, если оно есть, иначе прочитать заново. */
  readonly read: () => Promise<T>;
  /** Забыть невостребованное чтение. */
  readonly drop: () => void;
}

/** Дольше раннее чтение не ждёт: экран, открытый позже, читает свежее. */
const EARLY_MAX_AGE_MS = 30_000;

export function prefetch<T>(fetcher: () => Promise<T>): Prefetch<T> {
  let early: Promise<T> | null = null;
  let startedAt = 0;
  return {
    start: () => {
      if (early && Date.now() - startedAt < EARLY_MAX_AGE_MS) return;
      startedAt = Date.now();
      early = fetcher();
      // Ошибку увидит тот, кто возьмёт чтение; здесь она не должна стать «необработанной».
      early.catch(() => undefined);
    },
    read: () => {
      const taken = early && Date.now() - startedAt < EARLY_MAX_AGE_MS ? early : null;
      early = null;
      // B773: раннее чтение могло уйти раньше ответа о сессии — сбой читаем заново, один раз.
      return taken ? taken.catch(() => fetcher()) : fetcher();
    },
    drop: () => {
      early = null;
    },
  };
}
