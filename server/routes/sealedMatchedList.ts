import { buildMatchedVacancyPage } from '../vacancies/matchedVacancyPage';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import type { MatchedList } from './matchedVacancyList';

/** The one switch: false stops both reading and writing the table; no schema step is needed. */
export const SEALED_MATCHED_LIST_ENABLED = true;

/**
 * Prod 05.11: 799 rows are 137 pages of 40 KB, 5.5 MB, so ~1350 rows are ~9 MB: too much to open on
 * a busy thread. Only the pages a reader starts from are kept; a later page goes the usual way.
 */
export const SEALED_MATCHED_LIST_PAGES = 5;
export const SEALED_MATCHED_LIST_MAX_BYTES = 512_000;

/** Raise when the shape of a row or the order of a list changes: an older row is then not served. */
export const SEALED_MATCHED_LIST_VERSION = 1;

export interface SealedPage {
  readonly offset: number;
  readonly nextOffset: number | null;
  readonly items: readonly MatchedVacancyItem[];
}

export interface SealedMatchedList {
  readonly version: number;
  readonly choice: string;
  readonly total: number;
  readonly pageOffsets: readonly number[];
  readonly pages: readonly SealedPage[];
  readonly facets: MatchedList['facets'];
  readonly campaignWithHypotheses: MatchedList['campaignWithHypotheses'];
}

function firstPages(filtered: readonly MatchedVacancyItem[], pageOffsets: readonly number[]): SealedPage[] {
  return pageOffsets.slice(0, SEALED_MATCHED_LIST_PAGES).map((offset) => {
    const page = buildMatchedVacancyPage(filtered, offset, undefined, pageOffsets);
    return { offset, nextOffset: page.nextOffset, items: page.items };
  });
}

/** What goes to the table, or undefined when there is nothing worth keeping or it would not be short. */
export function sealedListText(list: MatchedList, choice: string): string | undefined {
  if (list.filtered.length === 0) return undefined;
  const sealed: SealedMatchedList = {
    version: SEALED_MATCHED_LIST_VERSION,
    choice,
    total: list.filtered.length,
    pageOffsets: list.pageOffsets,
    pages: firstPages(list.filtered, list.pageOffsets),
    facets: list.facets,
    campaignWithHypotheses: list.campaignWithHypotheses,
  };
  const text = JSON.stringify(sealed);
  return Buffer.byteLength(text, 'utf8') > SEALED_MATCHED_LIST_MAX_BYTES ? undefined : text;
}

/** The stored list if it answers this choice; a row of another version or choice is not an answer. */
export function sealedListAnswering(text: string, choice: string): SealedMatchedList | undefined {
  const sealed = JSON.parse(text) as SealedMatchedList;
  return sealed.version === SEALED_MATCHED_LIST_VERSION && sealed.choice === choice ? sealed : undefined;
}
