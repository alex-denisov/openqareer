import { LEAN_PAGE_SIZE, leanTrimmedRow } from '../vacancies/leanMatchedPage';
import { sealedSlice } from './b640SealedAnswer';
import type { SealedMatchedList, SealedPage } from './sealedMatchedList';

/**
 * B725: the lean page of 20 from the sealed list. A row sealed before the lean pages has only the
 * usual ones, and their rows from zero still cover the first lean page: the first read of a B640
 * account after the deploy stays sealed (PRB-055) instead of waiting for the pool.
 */
export function sealedLeanPage(sealed: SealedMatchedList, offset: number): SealedPage | undefined {
  const stored = sealed.leanPages?.find((page) => page.offset === offset);
  if (stored) return stored;
  if (offset % LEAN_PAGE_SIZE !== 0) return undefined;
  const slice = sealedSlice(sealed, offset, LEAN_PAGE_SIZE);
  if (!slice) return undefined;
  const next = offset + slice.rows.length;
  return {
    offset,
    nextOffset: next < sealed.total ? next : null,
    items: slice.rows.map(leanTrimmedRow),
  };
}
