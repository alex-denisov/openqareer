import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import type { LinkedinAccountPool } from './linkedinAccountPool';
import { parseLinkedinJobCards } from './linkedinParser';
import { parseLinkedinPostCards } from './linkedinPostParser';
import { ObscuraRunner } from './obscuraRunner';
import type { LinkedinProviderCapabilityVerdict } from './linkedinProviderCapability';

export interface PageNavigationResult {
  readonly status: number;
  readonly url: string;
  readonly content: string;
  /** Present for the real Obscura navigator; test navigators may omit it. */
  readonly authenticated?: boolean;
}

export type PageNavigator = (
  targetUrl: string,
  storagePath: string,
) => Promise<PageNavigationResult>;

export interface ScrapeQuery {
  readonly keywords: string;
  readonly location?: string;
  readonly start?: number;
}

export interface ScrapePostsQuery {
  readonly keywords?: string;
  readonly page?: number;
}

export interface ScrapeResult {
  readonly status:
    | 'success'
    | 'no_accounts_available'
    | 'exhausted_retries'
    | 'session_required'
    | 'provider_permission_required';
  readonly accountId?: string;
  readonly vacancies: readonly UnifiedVacancy[];
  readonly waitMs?: number;
}

export interface LinkedinScraperOptions {
  readonly pool: LinkedinAccountPool;
  readonly navigator?: PageNavigator;
  readonly minDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly proxyUrl?: string;
  readonly providerCapability?: LinkedinProviderCapabilityVerdict;
}

export function resolveLinkedinProxyUrl(explicitProxy?: string): string | undefined {
  if (explicitProxy) return explicitProxy;
  if (process.env.LINKEDIN_PROXY_URL) return process.env.LINKEDIN_PROXY_URL;
  if (process.env.WEBSHARE_LOGIN && process.env.WEBSHARE_PASSWORD) {
    const user = encodeURIComponent(`${process.env.WEBSHARE_LOGIN}-rotate`);
    const pass = encodeURIComponent(process.env.WEBSHARE_PASSWORD);
    return `http://${user}:${pass}@p.webshare.io:80`;
  }
  return undefined;
}

export class LinkedinScraper {
  public readonly pool: LinkedinAccountPool;
  private readonly navigator: PageNavigator;
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly providerCapability: LinkedinProviderCapabilityVerdict;

  constructor(options: LinkedinScraperOptions) {
    this.pool = options.pool;
    this.minDelayMs = options.minDelayMs ?? 8000;
    this.maxDelayMs = options.maxDelayMs ?? 25000;
    this.providerCapability = options.providerCapability ?? 'not_configured';

    this.navigator =
      options.navigator ??
      (async (targetUrl: string, storagePath: string) => {
        const runner = new ObscuraRunner({
          userDataDir: storagePath,
          headless: true,
          proxyUrl: resolveLinkedinProxyUrl(options.proxyUrl),
        });
        try {
          const page = await runner.openPage(targetUrl);
          const content = await page.content();
          const currentUrl = page.url();
          let authenticated: boolean | undefined;
          try {
            const cookies = await runner.fetchCookies(targetUrl);
            authenticated = cookies.some((cookie) => cookie.name === 'li_at' && cookie.value.length > 0);
          } catch {
            // A cookie read failure should not turn a successful page read into
            // a transport error; the caller will keep the optional signal
            // unknown and preserve injected navigator compatibility.
          }
          return { status: 200, url: currentUrl, content, authenticated };
        } finally {
          await runner.close();
        }
      });
  }

  public async scrapeJobs(query: ScrapeQuery): Promise<ScrapeResult> {
    const encodedKeywords = encodeURIComponent(query.keywords);
    const encodedLocation = encodeURIComponent(query.location ?? 'Remote');
    const startParam = query.start ? `&start=${query.start}` : '';
    const searchUrl = `https://www.linkedin.com/jobs/search?keywords=${encodedKeywords}&location=${encodedLocation}${startParam}`;

    return this.executeScrapeWithPool(searchUrl, parseLinkedinJobCards);
  }

  public async scrapePosts(query: ScrapePostsQuery = {}): Promise<ScrapeResult> {
    const rawKeywords = query.keywords?.trim() || '#hiring';
    const encodedKeywords = encodeURIComponent(rawKeywords);
    const pageParam = query.page && query.page > 1 ? `&page=${query.page}` : '';
    const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodedKeywords}&origin=GLOBAL_SEARCH_HEADER&sortBy=%22date_posted%22${pageParam}`;

    return this.executeScrapeWithPool(searchUrl, parseLinkedinPostCards);
  }

  // eslint-disable-next-line max-lines-per-function
  private async executeScrapeWithPool(
    targetUrl: string,
    parser: (content: string, context: { observedAt: string }) => readonly UnifiedVacancy[],
  ): Promise<ScrapeResult> {
    if (this.providerCapability === 'not_configured') {
      return { status: 'provider_permission_required', vacancies: [] };
    }
    const totalAccounts = this.pool.getPoolSummary().total;
    const maxAttempts = Math.max(1, totalAccounts);
    let sessionRequired = false;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const account = this.pool.getAvailableAccount();
      if (!account) {
        return {
          status: 'no_accounts_available',
          vacancies: [],
          waitMs: this.pool.getMinWaitTimeMs(),
        };
      }

      await this.applyJitter();

      try {
        const result = await this.navigator(targetUrl, account.storagePath);

        // A page can contain guest job cards while still showing LinkedIn's
        // login form. That is not an authenticated account scrape: do not
        // count guest cards as a successful read from the account pool.
        if (result.authenticated === false) {
          sessionRequired = true;
          this.pool.recordChallenge(account.id, 'authenticated_session_required');
          continue;
        }

        // Detect security checkpoint / captcha / bot challenge
        if (
          result.url.includes('/checkpoint/') ||
          result.content.includes('Security Verification') ||
          result.content.includes('quick-verification')
        ) {
          this.pool.recordChallenge(account.id, 'checkpoint_detected');
          continue; // Rotate to next account in pool
        }

        // Detect rate limit (429)
        if (result.status === 429) {
          this.pool.recordRateLimit(account.id);
          continue; // Rotate to next account in pool
        }

        const observedAt = new Date().toISOString();
        const vacancies = parser(result.content, { observedAt });

        this.pool.recordSuccess(account.id);

        return {
          status: 'success',
          accountId: account.id,
          vacancies,
        };
      } catch (_err) {
        this.pool.recordRateLimit(account.id, 60000); // short penalty on network timeout
      }
    }

    return {
      status: sessionRequired ? 'session_required' : 'exhausted_retries',
      vacancies: [],
      waitMs: this.pool.getMinWaitTimeMs(),
    };
  }

  private async applyJitter(): Promise<void> {
    if (this.maxDelayMs <= 0) return;
    const delay =
      this.minDelayMs + Math.random() * (this.maxDelayMs - this.minDelayMs);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
