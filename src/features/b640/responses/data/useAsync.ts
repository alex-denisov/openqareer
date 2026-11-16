import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage } from '../../../coach/apiClient';

export type AsyncState<T> =
  | { readonly status: 'loading'; readonly data: T | null }
  | { readonly status: 'error'; readonly data: T | null; readonly error: string }
  | { readonly status: 'ready'; readonly data: T };

export interface AsyncResult<T> {
  readonly state: AsyncState<T>;
  readonly reload: () => void;
  /** Подменить данные без запроса: после своего же действия. */
  readonly setData: (update: (current: T) => T) => void;
}

/**
 * Загрузка данных экрана: ожидание, ошибка с повтором и готовые данные.
 * `load` должен быть стабильной функцией (объявлен вне компонента или в `useCallback`).
 */
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, fallback: string): AsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading', data: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ status: 'loading', data: current.data }));
    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          status: 'error',
          data: current.data,
          error: apiErrorMessage(reason, fallback),
        }));
      });
    return () => controller.abort();
  }, [load, fallback, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const setData = useCallback((update: (current: T) => T) => {
    setState((current) =>
      current.data === null ? current : { ...current, data: update(current.data) },
    );
  }, []);

  return { state, reload, setData };
}
