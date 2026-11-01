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
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || !onLoadMore || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: `0px 0px ${LOAD_AHEAD_PX}px 0px` },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);
  return sentinel;
}
