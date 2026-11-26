import { useEffect } from 'react';

/**
 * B792: когда части «Карьеры» впервые на экране — метки Performance API от начала
 * перехода. По ним меряется прод: метка ставится при монтировании и не ждёт
 * отрисовки, поэтому замер в фоновой вкладке тоже верен. Каждая — один раз за загрузку.
 */
export type CareerMark = 'skeleton' | 'role' | 'roles' | 'count';

const PREFIX = 'b792:career:';

export function markCareer(part: CareerMark): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;
  const name = `${PREFIX}${part}`;
  if (performance.getEntriesByName(name, 'mark').length > 0) return;
  performance.mark(name);
}

/** Метка части при её первом показе. */
export function useCareerMark(part: CareerMark, shown = true): void {
  useEffect(() => {
    if (shown) markCareer(part);
  }, [part, shown]);
}
