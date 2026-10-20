/**
 * Which public catalog pages ask to be indexed (SEO review, 20.10).
 *
 * The pool aggregates other boards' text. Yandex marks mass copies of that
 * text as low-value, and crawl budget spent on short-lived cards is taken from
 * the place/role listings, which are the pages people actually search for. So
 * only a narrow set of cards is offered to search engines; every other card
 * stays reachable (`noindex, follow`) so links through it still count.
 *
 * Measured on prod 20.10 (307 170 active cards): salary + employer + English
 * role + seen within 14 days = 32 127 cards; adding "posted within 7 days"
 * gives 6 075. The posting window also keeps `validThrough` (posting + 30
 * days) at least three weeks in the future for every indexed card.
 */
import { catalogRoleOf } from '../vacancies/vacancyCatalogFacets';

/** A card nobody has re-observed for this long may already be gone at the source. */
export const CARD_SEEN_WITHIN_DAYS = 14;
/** Only recent postings are indexed; older ones keep their address, not the index slot. */
export const CARD_POSTED_WITHIN_DAYS = 7;
/** Our own horizon for a posting whose source named no withdrawal date. */
export const POSTING_VALID_DAYS = 30;
/**
 * 24 cards a page: the first 10 pages hold the 240 freshest cards. Deeper
 * pages repeat what the place/role listings already index and churn every
 * hour, so they stay crawlable for their links but out of the index.
 */
export const DEEP_PAGE_NOINDEX_AFTER = 10;

/**
 * Thin-content rule for listings (SEO review, round 2, 20.10). A listing is
 * published from 3 vacancies (`MIN_LISTING_SIZE`), but a page of 3 aggregated
 * cards is a near-duplicate of those cards. Prod has 4 745 place pages and
 * 4 531 place+role pages, most with 1–5 entries, so indexing them would spend
 * the crawl budget on doorway-like pages. Below these counts a listing still
 * renders (`noindex, follow`, links count) but is left out of the sitemap.
 */
export const INDEXED_PLACE_MIN = 10;
/**
 * A card whose source passed no job text (hh.ru search-page rows, measured on
 * prod 21.10: 11 of 60 sampled sitemap cards) carries only the title as
 * `JobPosting.description`. Google for Jobs treats that as thin and Yandex as a
 * copy, so such a card stays `noindex, follow`. `summary` is the first 300
 * characters of the job text, so the same rule runs in SQL on the stored column.
 */
export const INDEXED_CARD_SUMMARY_MIN = 100;
export const INDEXED_PLACE_ROLE_MIN = 5;

const DAY_MS = 86_400_000;

export interface IndexableCardFields {
  readonly title: string;
  readonly company: string;
  readonly salaryLabel?: string;
  readonly summary: string;
  readonly publishedAt: string;
  readonly lastSeenAt: string;
}

function withinDays(value: string, days: number, now: Date): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && now.getTime() - time <= days * DAY_MS;
}

/** The same rule the sitemap job applies in SQL (`catalogSitemapJob`). */
export function isIndexableCard(entry: IndexableCardFields, now: Date): boolean {
  return (
    Boolean(entry.salaryLabel) &&
    entry.summary.trim().length >= INDEXED_CARD_SUMMARY_MIN &&
    entry.company.trim().length > 0 &&
    catalogRoleOf(entry) !== null &&
    withinDays(entry.lastSeenAt, CARD_SEEN_WITHIN_DAYS, now) &&
    withinDays(entry.publishedAt, CARD_POSTED_WITHIN_DAYS, now)
  );
}

/** Withdrawal date when the source named one, else posting + 30 days. */
export function validThroughOf(publishedAt: string, withdrawnAt?: string): string | undefined {
  if (withdrawnAt && Number.isFinite(Date.parse(withdrawnAt))) return withdrawnAt;
  const posted = Date.parse(publishedAt);
  if (!Number.isFinite(posted)) return undefined;
  return new Date(posted + POSTING_VALID_DAYS * DAY_MS).toISOString();
}

export function isIndexablePage(page: number): boolean {
  return page <= DEEP_PAGE_NOINDEX_AFTER;
}

/** Whether a place (or place+role) listing with `total` vacancies asks to be indexed. */
export function isIndexableListing(total: number, hasRole: boolean): boolean {
  return total >= (hasRole ? INDEXED_PLACE_ROLE_MIN : INDEXED_PLACE_MIN);
}
