import type { Locator, Page } from 'playwright';
import { HH_SELECTORS } from './hhSelectors';

/**
 * A counter exactly as hh.ru rendered it: its own label plus the number it
 * printed. `count` stays `null` when the card shows a label without a parseable
 * number, so a missing figure never becomes a zero.
 */
export interface HhResumeCounter {
  readonly label: string;
  readonly count: number | null;
}

/**
 * One resume as hh.ru itself presents it on `/applicant/resumes`.
 *
 * Every field is copied from the page, never inferred: `updatedLabel` keeps
 * hh.ru's own wording (whitespace-normalised) so the product can never quietly
 * restate something hh.ru did not print, and a counter hh.ru does not render
 * stays `null` instead of becoming a zero.
 */
export interface HhResumeSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedLabel: string | null;
  readonly url: string;
  readonly searchShows: HhResumeCounter | null;
  readonly newViews: HhResumeCounter | null;
}

/** hh.ru resume hash ids are lowercase hex; anything else is not addressable. */
const RESUME_ID_PATTERN = /^[a-f0-9]{16,64}$/u;
const RESUME_PATH_PATTERN = /^\/resume\/([a-f0-9]{16,64})$/u;
const MAX_RESUMES = 50;

/**
 * Reads the candidate's own resume list from an already signed-in page.
 *
 * Read-only by construction: it navigates nothing, clicks nothing and returns
 * only cards whose public id could be parsed, so a redesigned card can never be
 * passed off as a resume the product may act on.
 */
export async function readHhResumeInventory(
  page: Page,
): Promise<readonly HhResumeSummary[]> {
  const cards = page.locator(HH_SELECTORS.resume.card);
  const total = Math.min(await cards.count(), MAX_RESUMES);
  const summaries: HhResumeSummary[] = [];
  for (let index = 0; index < total; index += 1) {
    const summary = await readResumeCard(cards.nth(index));
    if (summary) summaries.push(summary);
  }
  return summaries;
}

/** True when the account exposes the exact resume the owner declared. */
export function hasResumeId(
  resumes: readonly HhResumeSummary[],
  declaredId: string,
): boolean {
  const normalized = declaredId.trim().toLowerCase();
  return (
    RESUME_ID_PATTERN.test(normalized) &&
    resumes.some((resume) => resume.id === normalized)
  );
}

async function readResumeCard(card: Locator): Promise<HhResumeSummary | null> {
  const href = await card
    .locator(HH_SELECTORS.resume.cardLink)
    .first()
    .getAttribute('href')
    .catch(() => null);
  const id = parseResumeId(href);
  if (!id) return null;
  const title =
    (await text(card.locator(HH_SELECTORS.resume.item))) ??
    (await card.getAttribute('data-qa-title').catch(() => null))?.trim();
  if (!title) return null;
  return {
    id,
    title,
    updatedLabel: await text(card.locator(HH_SELECTORS.resume.updatedLabel)),
    url: `https://hh.ru/resume/${id}`,
    searchShows: counter(
      await text(card.locator(HH_SELECTORS.resume.searchShows)),
    ),
    newViews: counter(await text(card.locator(HH_SELECTORS.resume.newViews))),
  };
}

/** hh.ru renders the counter as label and number in adjacent nodes ("Показы3"). */
function counter(value: string | null): HhResumeCounter | null {
  if (!value) return null;
  const match = /^(.*?)\s*(\d[\d\s\u00a0]*)$/u.exec(value);
  if (!match) return { label: value, count: null };
  const label = match[1].trim();
  const count = Number.parseInt(match[2].replace(/[\s\u00a0]/gu, ''), 10);
  return {
    label: label.length > 0 ? label : value,
    count: Number.isSafeInteger(count) ? count : null,
  };
}

/** hh.ru links the card as `/resume/<id>?hhtmFrom=resume_list`. */
function parseResumeId(href: string | null): string | null {
  if (!href) return null;
  try {
    const match = RESUME_PATH_PATTERN.exec(
      new URL(href, 'https://hh.ru').pathname.toLowerCase(),
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** hh.ru separates date parts with non-breaking spaces. */
async function text(locator: Locator): Promise<string | null> {
  if ((await locator.count()) === 0) return null;
  const value = await locator
    .first()
    .textContent()
    .catch(() => null);
  const normalized = (value ?? '').replace(/\s+/gu, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}
