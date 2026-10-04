import { useEffect, useRef } from 'react';

type EscapeLayer = {
  id: number;
  close: () => void;
};

let nextLayerId = 0;
let layers: readonly EscapeLayer[] = [];

function handleEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const target = event.target;
  if (target instanceof HTMLSelectElement) return;
  const topLayer = layers.at(-1);
  if (!topLayer) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  topLayer.close();
}

function ensureListener(): void {
  if (typeof window !== 'undefined' && layers.length === 0) {
    window.addEventListener('keydown', handleEscape, true);
  }
}

/** Регистрирует слой интерфейса; Escape закрывает только последний открытый. */
export function registerEscapeLayer(close: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const layer = { id: ++nextLayerId, close };
  ensureListener();
  layers = [...layers, layer];
  return () => {
    layers = layers.filter((item) => item.id !== layer.id);
    if (layers.length === 0) window.removeEventListener('keydown', handleEscape, true);
  };
}

export function closeTopEscapeLayer(): boolean {
  const topLayer = layers.at(-1);
  if (!topLayer) return false;
  topLayer.close();
  return true;
}

export function useEscapeLayer(close: () => void, enabled = true): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!enabled) return;
    return registerEscapeLayer(() => closeRef.current());
  }, [enabled]);
}
