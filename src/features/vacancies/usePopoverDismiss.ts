import { useEffect, type RefObject } from 'react';

import { useEscapeLayer } from '../shell/escapeLayers';

/**
 * B446-r (R7): поповер фильтра закрывается, как диалоги по DESIGN.md, — по
 * Escape (общий слой escapeLayers: закрывается последний открытый) и по клику
 * вне него, с откатом черновика (как «Отмена»). Фокус возвращается на чип
 * группы. Клик по чипам панели не считается «снаружи»: чип сам переключает группу.
 */
export function usePopoverDismiss(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  chipSelector: string | undefined,
  onDismiss: () => void,
): void {
  const dismiss = () => {
    onDismiss();
    if (chipSelector) document.querySelector<HTMLElement>(chipSelector)?.focus();
  };
  useEscapeLayer(dismiss, active);
  useEffect(() => {
    if (!active) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || ref.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-filter-group]')) return;
      onDismiss();
      // Фокус после mousedown: иначе браузер переносит его на место клика.
      window.setTimeout(() => {
        if (chipSelector) document.querySelector<HTMLElement>(chipSelector)?.focus();
      }, 0);
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [ref, active, chipSelector, onDismiss]);
}
