import { describe, expect, it } from 'vitest';
import { LinkedinScraper, type PageNavigator } from '../linkedinScraper';
import { LinkedinAccountPool } from '../linkedinAccountPool';

describe('LinkedinScraper with Obscura pool rotation', () => {
  const sampleJobsHtml = `
    <li data-occludable-job-id="55443322">
      <div class="base-card">
        <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/55443322">
          <span class="sr-only">Senior Cloud Architect</span>
        </a>
        <div class="base-search-card__info">
          <h3 class="base-search-card__title">Senior Cloud Architect</h3>
          <h4 class="base-search-card__subtitle"><a href="/company/aws">AWS</a></h4>
          <span class="job-search-card__location">Remote</span>
        </div>
      </div>
    </li>
  `;

  it('scrapes vacancies using active account from pool and records success', async () => {
    const pool = new LinkedinAccountPool({
      accountIds: ['acc-1', 'acc-2'],
      storageRoot: '/tmp/test-crawlers',
    });

    const mockNavigator: PageNavigator = async () => ({
      status: 200,
      url: 'https://www.linkedin.com/jobs/search?keywords=Architect',
      content: sampleJobsHtml,
    });

    const scraper = new LinkedinScraper({
      pool,
      navigator: mockNavigator,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    const result = await scraper.scrapeJobs({ keywords: 'Architect', location: 'Remote' });

    expect(result.status).toBe('success');
    expect(result.vacancies).toHaveLength(1);
    expect(result.vacancies[0]?.title).toBe('Senior Cloud Architect');
    expect(result.vacancies[0]?.company).toBe('AWS');
    expect(result.accountId).toBe('acc-1');

    const summary = pool.getPoolSummary();
    expect(summary.active).toBe(2);
  });

  it('rotates to next account if current account hits checkpoint/challenge', async () => {
    const pool = new LinkedinAccountPool({
      accountIds: ['acc-1', 'acc-2'],
      storageRoot: '/tmp/test-crawlers',
    });

    let calls = 0;
    const mockNavigator: PageNavigator = async () => {
      calls += 1;
      if (calls === 1) {
        // First account hits challenge
        return {
          status: 200,
          url: 'https://www.linkedin.com/checkpoint/challenge/12345',
          content: '<html><title>Security Verification</title><body>Please solve captcha</body></html>',
        };
      }
      // Second account succeeds
      return {
        status: 200,
        url: 'https://www.linkedin.com/jobs/search?keywords=DevOps',
        content: sampleJobsHtml,
      };
    };

    const scraper = new LinkedinScraper({
      pool,
      navigator: mockNavigator,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    const result = await scraper.scrapeJobs({ keywords: 'DevOps', location: 'Remote' });

    expect(result.status).toBe('success');
    expect(result.accountId).toBe('acc-2');
    expect(result.vacancies).toHaveLength(1);

    const summary = pool.getPoolSummary();
    expect(summary.checkpointRequired).toBe(1);
    expect(summary.active).toBe(1);
  });

  it('returns no_accounts_available when all accounts are in cooldown or challenged', async () => {
    const pool = new LinkedinAccountPool({
      accountIds: ['acc-1'],
      storageRoot: '/tmp/test-crawlers',
    });

    pool.recordChallenge('acc-1', 'banned');

    const scraper = new LinkedinScraper({
      pool,
      navigator: async () => ({ status: 200, url: '', content: '' }),
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    const result = await scraper.scrapeJobs({ keywords: 'Rust', location: 'Remote' });
    expect(result.status).toBe('no_accounts_available');
    expect(result.vacancies).toHaveLength(0);
  });
});
