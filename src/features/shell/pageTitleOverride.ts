import { useEffect, useSyncExternalStore } from 'react';

/**
 * A screen opened inside a section (e.g. «Страны и релокация» inside «Карьера»)
 * names the page itself while it is mounted; the shell shows that name in the
 * top bar instead of the section name (mockup 15).
 */
let current: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePageTitleOverride(title: string): void {
  useEffect(() => {
    current = title;
    emit();
    return () => {
      if (current === title) {
        current = null;
        emit();
      }
    };
  }, [title]);
}

export function usePageTitleOverrideValue(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
