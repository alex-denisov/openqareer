import { useSyncExternalStore } from 'react';

/** Ширина, с которой макеты B640 считают экран телефоном. */
export const MOBILE_QUERY = '(max-width: 767px)';

/** Совпадает ли медиазапрос сейчас; пересчитывается при изменении окна. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}
