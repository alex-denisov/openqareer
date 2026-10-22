import { useLayoutEffect, type RefObject } from 'react';

/** Нижние полосы, которые перекрывают поповер на узком окне (консультант снизу). */
const BOTTOM_OVERLAYS = '.career-expert-panel, .career-expert-peek, .career-mobile-nav';
const GAP = 8;

function overlayTop(popover: DOMRect): number {
  let limit = window.innerHeight;
  for (const node of document.querySelectorAll<HTMLElement>(BOTTOM_OVERLAYS)) {
    const rect = node.getBoundingClientRect();
    const overlaps = rect.left < popover.right && rect.right > popover.left;
    if (overlaps && rect.height > 0 && rect.top > popover.top && rect.top < limit) {
      limit = rect.top;
    }
  }
  return limit;
}

/**
 * B446-r (R6): поповер фильтра не выходит за окно и не уходит под полосу
 * консультанта — его высота считается от верхнего края до видимого низа.
 * Окно .app уменьшают сознательно, поэтому пересчёт на каждое изменение размера.
 */
export function usePopoverViewportLimit(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !active) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      const room = Math.max(160, overlayTop(rect) - rect.top - GAP);
      node.style.setProperty('--vacancies-filter-pop-max', `${Math.floor(room)}px`);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      node.style.removeProperty('--vacancies-filter-pop-max');
    };
  }, [ref, active]);
}
