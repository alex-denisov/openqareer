import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

export function useArchivedResponsesNavigation(
  initiallyOpen: boolean,
  hasArchive: boolean,
  setExpanded: Dispatch<SetStateAction<boolean>>,
) {
  const toggleRef = useRef<HTMLButtonElement>(null);
  const focusedOnNavigation = useRef(false);

  useEffect(() => {
    if (!initiallyOpen) {
      focusedOnNavigation.current = false;
      setExpanded(false);
      return;
    }
    if (!hasArchive || focusedOnNavigation.current) return;

    focusedOnNavigation.current = true;
    setExpanded(true);
    return deferUntilNavigationScroll(() => focusArchiveToggle(toggleRef.current));
  }, [hasArchive, initiallyOpen, setExpanded]);

  return toggleRef;
}

function focusArchiveToggle(toggle: HTMLButtonElement | null) {
  toggle?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
  toggle?.focus({ preventScroll: true });
}

function deferUntilNavigationScroll(action: () => void) {
  if (typeof window.requestAnimationFrame !== 'function') {
    const timer = window.setTimeout(action, 0);
    return () => window.clearTimeout(timer);
  }

  let secondFrame: number | undefined;
  const firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(action);
  });
  return () => {
    window.cancelAnimationFrame(firstFrame);
    if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame);
  };
}
