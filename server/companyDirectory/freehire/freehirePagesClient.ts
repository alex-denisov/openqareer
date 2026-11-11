/**
 * B645: polite reader of freehire.me public pages. Requests start at least `gapMs`
 * apart (3/s by default) with up to 3 in flight; a 429 or 5xx doubles the gap and
 * waits, clean answers slowly narrow it back. Same IP always; a long Retry-After is
 * freehire's own limit and stops the pass (FreehirePagesLimitError) instead of retrying.
 */
import {
  FREEHIRE_SITE,
  PAGES_USER_AGENT,
  cardOfPageData,
  slugsOfSitemap,
  type FreehirePageCard,
} from './freehirePages';

const MIN_GAP_MS = 250;
const START_GAP_MS = 333;
const MAX_GAP_MS = 15_000;
const MAX_ATTEMPTS = 4;
const LONG_RETRY_AFTER_S = 600;

export class FreehirePagesLimitError extends Error {
  constructor(
    readonly untilMs: number,
    readonly status: number,
  ) {
    super(`freehire pages limited (HTTP ${status})`);
    this.name = 'FreehirePagesLimitError';
  }
}

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class FreehirePagesClient {
  private gapMs = START_GAP_MS;
  private nextAt = 0;
  throttled = 0;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: Sleep = realSleep,
    private readonly now: () => number = Date.now,
  ) {}

  get currentGapMs(): number {
    return this.gapMs;
  }

  /** Reserves the next start slot so parallel callers stay `gapMs` apart. */
  private async slot(): Promise<void> {
    const at = Math.max(this.now(), this.nextAt);
    this.nextAt = at + this.gapMs;
    const wait = at - this.now();
    if (wait > 0) await this.sleep(wait);
  }

  private async get(path: string, accept: string): Promise<string | null> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await this.slot();
      let status = 0;
      let retryAfter = 0;
      try {
        const response = await this.fetchImpl(`${FREEHIRE_SITE}${path}`, {
          headers: { accept, 'user-agent': PAGES_USER_AGENT },
          signal: AbortSignal.timeout(30_000),
        });
        status = response.status;
        if (status === 200) {
          this.gapMs = Math.max(MIN_GAP_MS, Math.round(this.gapMs * 0.98));
          return await response.text();
        }
        if (status === 404 || status === 410) return null;
        retryAfter = Number(response.headers?.get('retry-after')) || 0;
      } catch {
        status = 0;
      }
      if (status !== 0 && status !== 429 && status < 500)
        throw new Error(`freehire HTTP ${status}`);
      if (status === 429 || status >= 500) {
        this.throttled += 1;
        this.gapMs = Math.min(MAX_GAP_MS, this.gapMs * 2);
      }
      if (status === 429 && retryAfter > LONG_RETRY_AFTER_S)
        throw new FreehirePagesLimitError(this.now() + retryAfter * 1000, status);
      const pause = Math.max(retryAfter * 1000, 2 ** attempt * 2_000);
      this.nextAt = Math.max(this.nextAt, this.now() + pause);
      await this.sleep(pause);
    }
    throw new Error(`freehire ${path} failed after ${MAX_ATTEMPTS} attempts`);
  }

  async sitemapSlugs(offset: number): Promise<readonly string[]> {
    const xml = await this.get(`/sitemap-companies.xml?offset=${offset}`, 'application/xml');
    return xml ? slugsOfSitemap(xml) : [];
  }

  /** undefined: page failed after retries; null: no company on the page. */
  async card(slug: string): Promise<FreehirePageCard | null | undefined> {
    try {
      const body = await this.get(
        `/companies/${encodeURIComponent(slug)}/__data.json`,
        'application/json',
      );
      return body ? cardOfPageData(slug, JSON.parse(body)) : null;
    } catch (error: unknown) {
      if (error instanceof FreehirePagesLimitError) throw error;
      return undefined;
    }
  }
}
