import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import type { LinkedinAccountPool } from './linkedinAccountPool';
import { parseLinkedinJobCards } from './linkedinParser';
import { ObscuraRunner } from './obscuraRunner';

export interface PageNavigationResult {
  readonly status: number;
  readonly url: string;
  readonly content: string;
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

export interface ScrapeResult {
  readonly status: 'success' | 'no_accounts_available' | 'exhausted_retries';
  readonly accountId?: string;
  readonly vacancies: readonly UnifiedVacancy[];
  readonly waitMs?: number;
}

export interface LinkedinScraperOptions {
  readonly pool: LinkedinAccountPool;
  readonly navigator?: PageNavigator;
  readonly minDelayMs?: number;
  readonly maxDelayMs?: number;
}

export class LinkedinScraper {
  private readonly pool: LinkedinAccountPool;
  private readonly navigator: PageNavigator;
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(options: LinkedinScraperOptions) {
    this.pool = options.pool;
    this.minDelayMs = options.minDelayMs ?? 8000;
    this.maxDelayMs = options.maxDelayMs ?? 25000;

    this.navigator =
      options.navigator ??
      (async (targetUrl: string, storagePath: string) => {
        const runner = new ObscuraRunner({
          userDataDir: storagePath,
          headless: true,
        });
        try {
          const page = await runner.openPage(targetUrl);
          const content = await page.content();
          const currentUrl = page.url();
          return { status: 200, url: currentUrl, content };
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

    const totalAccounts = this.pool.getPoolSummary().total;
    const maxAttempts = Math.max(1, totalAccounts);

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
        const result = await this.navigator(searchUrl, account.storagePath);

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
        const vacancies = parseLinkedinJobCards(result.content, { observedAt });

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
      status: 'exhausted_retries',
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
