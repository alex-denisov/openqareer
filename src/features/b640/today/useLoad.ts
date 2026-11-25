import { useCallback, useEffect, useState } from 'react';
import { readEarlyOr } from '../../shell/earlyRead';
import { readSectionCache, writeSectionCache } from '../../shell/sectionCache';

export type LoadState<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly data: T }
  | { readonly state: 'error' };

export type Load<T> = LoadState<T> & { readonly retry: () => void };

/**
 * Одно чтение для блока экрана: ожидание, данные или ошибка с повтором.
 * `retry` после успешного чтения обновляет данные на месте; при сбое остаются прежние.
 * `loader` должен быть постоянной ссылкой (функция модуля), иначе чтение повторится.
 * `cacheKey` (B792): прошлое чтение видно с первого кадра, свежее заменяет его на месте.
 */
export function useLoad<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  cacheKey?: string,
): Load<T> {
  const [result, setResult] = useState<LoadState<T>>(() => {
    const cached = cacheKey ? readSectionCache<{ readonly data: T }>(cacheKey) : undefined;
    return cached ? { state: 'ready', data: cached.data } : { state: 'loading' };
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    // Повторное чтение не прячет уже показанные данные: экран не мигает скелетом.
    setResult((previous) => (previous.state === 'ready' ? previous : { state: 'loading' }));
    readEarlyOr(loader, controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        if (cacheKey) writeSectionCache(cacheKey, { data });
        setResult({ state: 'ready', data });
      },
      () => {
        if (controller.signal.aborted) return;
        setResult((previous) => (previous.state === 'ready' ? previous : { state: 'error' }));
      },
    );
    return () => controller.abort();
  }, [loader, attempt, cacheKey]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { ...result, retry };
}
