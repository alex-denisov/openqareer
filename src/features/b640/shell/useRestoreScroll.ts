import { useLayoutEffect } from 'react';
import { restoreScroll } from './scrollMemory';

/** После смены адреса экран встаёт на то место, где его оставили. */
export function useRestoreScroll(pathname: string, search: string): void {
  useLayoutEffect(() => restoreScroll(), [pathname, search]);
}
