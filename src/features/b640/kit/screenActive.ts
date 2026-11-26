import { createContext, useContext, useEffect, useRef } from 'react';

/** `false` — список остался открытым под другим экраном (B798). */
export const ScreenActive = createContext(true);

export function useScreenActive(): boolean {
  return useContext(ScreenActive);
}

/** Список снова на экране: тихо обновить то, что могло измениться, пока он был закрыт. */
export function useOnReveal(refresh: () => void): void {
  const active = useScreenActive();
  const before = useRef(active);
  useEffect(() => {
    if (active && !before.current) refresh();
    before.current = active;
  }, [active, refresh]);
}
