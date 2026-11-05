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
 * role + seen within 14 days = 32 127 cards.
 *
 * 03.11: a "posted within 7 days" window used to sit on top. It turned every
 * live card `noindex` on its eighth day; Google saw 3 834 such pages from
 * 24.10 and impressions fell 259 → 30 a day. A card now stays indexed while it
 * is live (seen recently, `validThrough` ahead); measured on prod 03.11:
 * 3 115 → 8 430 cards.
 *
 * 05.11: salary is no longer a condition (Google only recommends `baseSalary`).
 * A card without one enters gradually (`catalogCardRollout.ts`); cards the
 * salary rule already indexes stay, so the set never shrinks on the switch.
 */
import { catalogRoleOf } from '../vacancies/vacancyCatalogFacets';

/** A card nobody has re-observed for this long may already be gone at the source. */
export const CARD_SEEN_WITHIN_DAYS = 14;
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
/**
 * Hysteresis for listings (03.11). A listing that crossed its threshold keeps
 * `index` and its sitemap line for this long while it still has a vacancy:
 * a city+role page around 5 entries used to flip index/noindex/410 daily, and
 * Googlebot got ~560 4xx on listings it had indexed in ten days.
 */
export const LISTING_RETAIN_DAYS = 30;

const DAY_MS = 86_400_000;

export interface IndexableCardFields {
  readonly title: string;
  readonly company: string;
  readonly salaryLabel?: string;
  readonly summary: string;
  readonly publishedAt: string;
  readonly lastSeenAt: string;
  /** Withdrawal date when the source named one. */
  readonly withdrawnAt?: string;
  /** Our own Russian summary exists (`catalogRuSummary.ts`): the card counts as described. */
  readonly hasRuSummary?: boolean;
  /** Admitted by the gradual rollout, and the page has its text. */
  readonly rolloutAdmitted?: boolean;
}

/** A salary label with a real amount: «0 $» is an unknown salary, not a salary. */
export function hasKnownSalary(label: string | undefined): boolean {
  return /[1-9]/u.test(label ?? '');
}

/**
 * Quality rules: the card has something a search result can show. Kept as a
 * list so another rule (a Russian summary counting as a description) is one
 * more line, not a rewrite.
 */
const CARD_QUALITY_RULES: ReadonlyArray<(entry: IndexableCardFields) => boolean> = [
  (entry) =>
    entry.rolloutAdmitted === true ||
    (hasKnownSalary(entry.salaryLabel) &&
      // 03.11: hh.ru search rows carry no snippet, but a Russian summary of the loaded text describes the card.
      (entry.hasRuSummary === true || entry.summary.trim().length >= INDEXED_CARD_SUMMARY_MIN)),
  (entry) => entry.company.trim().length > 0,
  (entry) => catalogRoleOf(entry) !== null,
];

/** Live: re-observed recently and not past its `validThrough`. */
function isLiveCard(entry: IndexableCardFields, now: Date): boolean {
  if (!withinDays(entry.lastSeenAt, CARD_SEEN_WITHIN_DAYS, now)) return false;
  const validThrough = validThroughOf(entry.publishedAt, entry.withdrawnAt, entry.lastSeenAt);
  return validThrough === undefined || Date.parse(validThrough) > now.getTime();
}

function withinDays(value: string, days: number, now: Date): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && now.getTime() - time <= days * DAY_MS;
}

/** The same rule the sitemap job applies in SQL (`catalogSitemapJob`). */
export function isIndexableCard(entry: IndexableCardFields, now: Date): boolean {
  return CARD_QUALITY_RULES.every((rule) => rule(entry)) && isLiveCard(entry, now);
}

/**
 * Withdrawal date when the source named one, else 30 days after the later of
 * posting and the last time we saw the posting still up: a card re-observed
 * today is not expiring next week because it was posted a month ago.
 */
export function validThroughOf(
  publishedAt: string,
  withdrawnAt?: string,
  lastSeenAt?: string,
): string | undefined {
  if (withdrawnAt && Number.isFinite(Date.parse(withdrawnAt))) return withdrawnAt;
  const posted = Date.parse(publishedAt);
  if (!Number.isFinite(posted)) return undefined;
  const seen = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN;
  const from = Number.isFinite(seen) ? Math.max(posted, seen) : posted;
  return new Date(from + POSTING_VALID_DAYS * DAY_MS).toISOString();
}

export function isIndexablePage(page: number): boolean {
  return page <= DEEP_PAGE_NOINDEX_AFTER;
}

/** Last time a listing met its threshold, kept by the maintenance process. */
export interface ListingIndexHistory {
  readonly firstQualifiedAt?: string;
  readonly lastQualifiedAt?: string;
  /** Last daily read of Search Console that showed impressions (`catalogSearchEvidence`). */
  readonly lastImpressionAt?: string;
}

export function listingQualifies(total: number, hasRole: boolean): boolean {
  return total >= (hasRole ? INDEXED_PLACE_ROLE_MIN : INDEXED_PLACE_MIN);
}

/**
 * Whether a place (or place+role) listing with `total` vacancies asks to be
 * indexed: at its threshold, or for `LISTING_RETAIN_DAYS` after it last met it
 * or last had impressions in Google, while it has at least one vacancy.
 */
export function isIndexableListing(
  total: number,
  hasRole: boolean,
  history?: ListingIndexHistory,
  now: Date = new Date(),
): boolean {
  if (listingQualifies(total, hasRole)) return true;
  if (total < 1) return false;
  return [history?.lastQualifiedAt, history?.lastImpressionAt].some(
    (at) => at !== undefined && withinDays(at, LISTING_RETAIN_DAYS, now),
  );
}
