import { useCallback, useEffect, useState } from 'react';

export type LoadState<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly data: T }
  | { readonly state: 'error' };

export type Load<T> = LoadState<T> & { readonly retry: () => void };

/**
 * Одно чтение для блока экрана: ожидание, данные или ошибка с повтором.
 * `retry` после успешного чтения обновляет данные на месте; при сбое остаются прежние.
 * `loader` должен быть постоянной ссылкой (функция модуля), иначе чтение повторится.
 */
export function useLoad<T>(loader: (signal: AbortSignal) => Promise<T>): Load<T> {
  const [result, setResult] = useState<LoadState<T>>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    // Повторное чтение не прячет уже показанные данные: экран не мигает скелетом.
    setResult((previous) => (previous.state === 'ready' ? previous : { state: 'loading' }));
    loader(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ state: 'ready', data });
      },
      () => {
        if (controller.signal.aborted) return;
        setResult((previous) => (previous.state === 'ready' ? previous : { state: 'error' }));
      },
    );
    return () => controller.abort();
  }, [loader, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { ...result, retry };
}
