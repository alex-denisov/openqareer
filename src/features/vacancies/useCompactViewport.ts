import { useEffect, useState } from 'react';

const COMPACT_QUERY = '(max-width: 760px)';

function matchesCompact(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(COMPACT_QUERY).matches
    : false;
}

/** The same 760 px break the mobile shell and profile use. */
export function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(matchesCompact);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
}

/** A row opens as a push screen only when chosen on a narrow screen;
 *  narrowing the window keeps an already open row inline (B549). */
export function useOpenedCompact(): boolean {
  const compact = useCompactViewport();
  const [openedCompact] = useState(compact);
  return compact && openedCompact;
}
