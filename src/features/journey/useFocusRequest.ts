import { useEffect, useRef, type RefObject } from 'react';

/**
 * Moves focus to `target` once per new `request`. Runs after the panel's own mount
 * focus, and waits for `ready`: while the session loads the input is not there yet.
 */
export function useFocusRequest(
  target: RefObject<HTMLElement | null>,
  request: number | undefined,
  ready: boolean,
): void {
  const handled = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!request || request === handled.current || !ready || !target.current) return;
    handled.current = request;
    target.current.focus();
  }, [request, ready, target]);
}
