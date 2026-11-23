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

export function prefetch<T>(fetcher: () => Promise<T>): Prefetch<T> {
  let early: Promise<T> | null = null;
  return {
    start: () => {
      if (early) return;
      early = fetcher();
      // Ошибку увидит тот, кто возьмёт чтение; здесь она не должна стать «необработанной».
      early.catch(() => undefined);
    },
    read: () => {
      const taken = early;
      early = null;
      return taken ?? fetcher();
    },
    drop: () => {
      early = null;
    },
  };
}
