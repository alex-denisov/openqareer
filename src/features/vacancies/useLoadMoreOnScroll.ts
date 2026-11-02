import { useEffect, useRef } from 'react';

/** Load the next rows this far before the list end reaches the viewport. */
const LOAD_AHEAD_PX = 400;

/**
 * 01.11 (.app acceptance): reaching the end of 144 rows took 7 clicks on «Показать ещё 20».
 * The list now loads the next rows when its end scrolls into view; the button stays as the
 * keyboard and no-observer fallback.
 */
export function useLoadMoreOnScroll(hasMore: boolean, onLoadMore: (() => void) | undefined) {
  const sentinel = useRef<HTMLDivElement>(null);
  // 02.11: a new callback on every render re-created the observer, which fired again while the
  // list end stayed in view — a load loop that kept replacing «Показать ещё 20» (AUD-4 red on main).
  const latest = useRef(onLoadMore);
  latest.current = onLoadMore;
  const canLoad = Boolean(onLoadMore);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || !canLoad || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current?.();
      },
      { rootMargin: `0px 0px ${LOAD_AHEAD_PX}px 0px` },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, canLoad]);
  return sentinel;
}
