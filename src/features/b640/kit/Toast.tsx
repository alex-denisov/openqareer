import { useEffect, useSyncExternalStore } from 'react';
import { Icon } from './Icon';

export interface ToastOptions {
  readonly text: string;
  readonly undo?: { readonly label: string; readonly onUndo: () => void };
  /** Через сколько миллисекунд тост исчезает; по умолчанию 6000. */
  readonly timeoutMs?: number;
}

interface ActiveToast extends ToastOptions {
  readonly id: number;
}

/** Один тост за раз: хранилище общее, чтобы хост в корне и вызовы с экранов не зависели от дерева. */
let current: ActiveToast | null = null;
let counter = 0;
const listeners = new Set<() => void>();

function publish(next: ActiveToast | null): void {
  current = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const read = (): ActiveToast | null => current;

const toastApi = {
  show(options: ToastOptions): void {
    counter += 1;
    publish({ ...options, id: counter });
  },
  hide(): void {
    publish(null);
  },
};

export function useToast(): { readonly show: (options: ToastOptions) => void; readonly hide: () => void } {
  return toastApi;
}

const DEFAULT_TIMEOUT_MS = 6000;

/** Один на корень кабинета: область `role=status`, в ней текущий тост. */
export function ToastHost() {
  const toast = useSyncExternalStore(subscribe, read, () => null);
  const id = toast?.id;
  const timeoutMs = toast?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  useEffect(() => {
    if (id === undefined) return undefined;
    const timer = setTimeout(toastApi.hide, timeoutMs);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') toastApi.hide();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
    };
  }, [id, timeoutMs]);

  return (
    <div role="status" aria-live="polite">
      {toast ? (
        <div className="va-snack" key={toast.id}>
          <span>{toast.text}</span>
          {toast.undo ? (
            <button
              className="row-act va-undo"
              type="button"
              onClick={() => {
                toast.undo?.onUndo();
                toastApi.hide();
              }}
            >
              <Icon name="undo" />
              {toast.undo.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
