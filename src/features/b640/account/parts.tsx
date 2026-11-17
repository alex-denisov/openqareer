import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { B640Node } from '../routes';

export type LoadState<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly data: T }
  | { readonly state: 'error' };

export type Load<T> = LoadState<T> & {
  readonly retry: () => void;
  /** Подменяет прочитанные данные результатом действия, без нового запроса. */
  readonly replace: (data: T) => void;
  /** Меняет прочитанные данные от их текущего значения: несколько правок подряд не затирают друг друга. */
  readonly update: (change: (data: T) => T) => void;
};

/**
 * Одно чтение для экрана: ожидание, данные или ошибка с повтором. `loader` — функция
 * модуля (постоянная ссылка). Повтор не прячет уже показанные данные.
 */
export function useLoad<T>(loader: () => Promise<T>): Load<T> {
  const [result, setResult] = useState<LoadState<T>>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    loader().then(
      (data) => active && setResult({ state: 'ready', data }),
      () => active && setResult((previous) => (previous.state === 'ready' ? previous : { state: 'error' })),
    );
    return () => {
      active = false;
    };
  }, [loader, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const replace = useCallback((data: T) => setResult({ state: 'ready', data }), []);
  const update = useCallback(
    (change: (data: T) => T) =>
      setResult((previous) =>
        previous.state === 'ready' ? { state: 'ready', data: change(previous.data) } : previous,
      ),
    [],
  );
  return useMemo(() => ({ ...result, retry, replace, update }), [result, retry, replace, update]);
}

/** Ошибка на месте: `p.set-res.is-err` с «Повторить». */
export function ErrorLine({ text, onRetry }: { readonly text: string; readonly onRetry?: () => void }) {
  return (
    <p className="set-res is-err" role="alert">
      <span>{text}</span>
      {onRetry ? (
        <button className="btn is-sm" type="button" onClick={onRetry}>
          Повторить
        </button>
      ) : null}
    </p>
  );
}

export interface SettingsPageProps {
  readonly node: B640Node;
  /** Заголовок страницы для экранного чтеца (в макете — `h2.vh`). */
  readonly heading: string;
  readonly busy?: boolean;
  readonly children: ReactNode;
}

/** Страница настроек аккаунта: `div.page.set-page` с атрибутами узла. */
export function SettingsPage({ node, heading, busy = false, children }: SettingsPageProps) {
  return (
    <div
      className="page set-page"
      data-b640-node={node.code}
      data-b640-section={node.section}
      aria-busy={busy || undefined}
    >
      <h2 className="vh">{heading}</h2>
      {children}
    </div>
  );
}
