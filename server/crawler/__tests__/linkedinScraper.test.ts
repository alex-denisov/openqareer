import { describe, expect, it } from 'vitest';
import { LinkedinScraper, resolveLinkedinProxyUrl, type PageNavigator } from '../linkedinScraper';
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

  it('does not count guest cards when the account has no authenticated session', async () => {
    const pool = new LinkedinAccountPool({
      accountIds: ['acc-1'],
      storageRoot: '/tmp/test-crawlers',
    });
    const scraper = new LinkedinScraper({
      pool,
      navigator: async () => ({
        status: 200,
        url: 'https://www.linkedin.com/jobs/search',
        authenticated: false,
        content: '<input autocomplete="username"><li data-occludable-job-id="guest">',
      }),
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    const result = await scraper.scrapeJobs({ keywords: 'Rust', location: 'Remote' });

    expect(result.status).toBe('session_required');
    expect(result.vacancies).toHaveLength(0);
    expect(pool.getPoolSummary().checkpointRequired).toBe(1);
  });

  it('scrapes #hiring posts from LinkedIn content search feed', async () => {
    const pool = new LinkedinAccountPool({
      accountIds: ['acc-1'],
      storageRoot: '/tmp/test-crawlers',
    });

    const samplePostContentHtml = `
      <div class="feed-shared-update-v2" data-urn="urn:li:activity:7999111222333">
        <div class="update-components-actor">
          <a class="update-components-actor__meta-link" href="https://www.linkedin.com/in/recruiter1">
            <span class="update-components-actor__name">Alice Recruiter</span>
            <span class="update-components-actor__description">Talent Lead at TechCorp</span>
          </a>
        </div>
        <div class="update-components-text">
          <span class="break-words">
            We are hiring! Looking for a Senior Full Stack Engineer (React/Node.js).
            Remote. Send email to jobs@techcorp.com #hiring #fullstack
          </span>
        </div>
      </div>
    `;

    let calledUrl = '';
    const mockNavigator: PageNavigator = async (targetUrl) => {
      calledUrl = targetUrl;
      return {
        status: 200,
        url: targetUrl,
        content: samplePostContentHtml,
      };
    };

    const scraper = new LinkedinScraper({
      pool,
      navigator: mockNavigator,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    const result = await scraper.scrapePosts({ keywords: '#hiring react' });

    expect(result.status).toBe('success');
    expect(calledUrl).toContain('/search/results/content/');
    expect(calledUrl).toContain('sortBy=%22date_posted%22');
    expect(result.vacancies).toHaveLength(1);
    expect(result.vacancies[0]?.title).toContain('Senior Full Stack Engineer');
    expect(result.vacancies[0]?.company).toBe('TechCorp');
    expect(result.vacancies[0]?.provenance.sourceId).toBe('src-linkedin-posts');
  });

  it('resolves proxy URL prioritizing explicit proxy, then LINKEDIN_PROXY_URL, then Webshare', () => {
    const origEnv = { ...process.env };
    try {
      delete process.env.LINKEDIN_PROXY_URL;
      delete process.env.WEBSHARE_LOGIN;
      delete process.env.WEBSHARE_PASSWORD;

      expect(resolveLinkedinProxyUrl()).toBeUndefined();

      expect(resolveLinkedinProxyUrl('http://custom:8080')).toBe('http://custom:8080');

      process.env.LINKEDIN_PROXY_URL = 'http://env-proxy:9000';
      expect(resolveLinkedinProxyUrl()).toBe('http://env-proxy:9000');

      delete process.env.LINKEDIN_PROXY_URL;
      process.env.WEBSHARE_LOGIN = 'myuser';
      process.env.WEBSHARE_PASSWORD = 'mypassword';
      expect(resolveLinkedinProxyUrl()).toBe('http://myuser-rotate:mypassword@p.webshare.io:80');
    } finally {
      process.env = origEnv;
    }
  });
});
