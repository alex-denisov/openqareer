import { describe, expect, it, vi } from 'vitest';
import { LinkedinAccountPool } from '../linkedinAccountPool';
import { LinkedinScraper } from '../linkedinScraper';
import {
  fetchLinkedinCrawler,
  LINKEDIN_CRAWLER_SOURCE_ID,
} from '../linkedinIngestRunner';
import { buildMultiSourceFetcher } from '../../vacancies/multiSourceFetcher';
import type { UnifiedVacancy, VacancySourceConfig } from '../../domain/unifiedVacancy';

describe('Linkedin Ingest Runner (B208)', () => {
  const dummyJobVacancy: UnifiedVacancy = {
    id: 'src-linkedin-pool:112233',
    fingerprint: 'src-linkedin-pool:112233',
    title: 'Senior Software Engineer',
    company: 'Tech Corp',
    location: 'Remote',
    isRemote: true,
    description: 'Looking for a Senior Software Engineer',
    requiredSkills: ['TypeScript', 'Node.js'],
    url: 'https://www.linkedin.com/jobs/view/112233',
    provenance: {
      sourceType: 'browser_session',
      sourceId: 'src-linkedin-pool',
      sourceUrl: 'https://www.linkedin.com/jobs/view/112233',
      observedAt: '2026-09-16T00:00:00.000Z',
    },
    publishedAt: '2026-09-16T00:00:00.000Z',
    status: 'active',
  };

  const dummyPostVacancy: UnifiedVacancy = {
    id: 'src-linkedin-posts:urn:li:activity:998877',
    fingerprint: 'src-linkedin-posts:urn:li:activity:998877',
    title: 'Lead Frontend Developer',
    company: 'StartupX',
    location: 'Remote',
    isRemote: true,
    description: 'We are hiring a Lead Frontend Developer! Contact me #hiring',
    requiredSkills: ['React'],
    url: 'https://www.linkedin.com/feed/update/urn:li:activity:998877/',
    provenance: {
      sourceType: 'browser_session',
      sourceId: 'src-linkedin-posts',
      sourceUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:998877/',
      observedAt: '2026-09-16T00:00:00.000Z',
    },
    publishedAt: '2026-09-16T00:00:00.000Z',
    status: 'active',
  };

  it('handles empty account pool gracefully without crashing or throwing', async () => {
    const emptyPool = new LinkedinAccountPool({
      accountIds: [],
      storageRoot: '/tmp/test-crawlers/empty-pool',
    });

    const reading = await fetchLinkedinCrawler({ pool: emptyPool });

    expect(reading.partial).toBe(true);
    expect(reading.vacancies).toEqual([]);
  });

  it('handles account pool when all accounts are in cooldown or checkpoint', async () => {
    const pool = new LinkedinAccountPool({
      accountIds: ['acc-1', 'acc-2'],
      storageRoot: '/tmp/test-crawlers/cooldown-pool',
    });

    pool.recordRateLimit('acc-1', 60000);
    pool.recordChallenge('acc-2', 'checkpoint_detected');

    const reading = await fetchLinkedinCrawler({ pool });

    expect(reading.partial).toBe(true);
    expect(reading.vacancies).toEqual([]);
  });

  it('runs crawl pass for keywords and posts, formatting results into UnifiedVacancy SourceReading', async () => {
    const pool = new LinkedinAccountPool({
      accountIds: ['acc-1'],
      storageRoot: '/tmp/test-crawlers/active-pool',
    });

    const scraper = new LinkedinScraper({
      pool,
      navigator: async () => ({ status: 200, url: '', content: '' }),
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    const scrapeJobsSpy = vi
      .spyOn(scraper, 'scrapeJobs')
      .mockResolvedValueOnce({
        status: 'success',
        accountId: 'acc-1',
        vacancies: [dummyJobVacancy],
      });

    const scrapePostsSpy = vi
      .spyOn(scraper, 'scrapePosts')
      .mockResolvedValueOnce({
        status: 'success',
        accountId: 'acc-1',
        vacancies: [dummyPostVacancy],
      });

    const reading = await fetchLinkedinCrawler({
      pool,
      scraper,
      keywords: ['Software Engineer'],
      postKeywords: ['#hiring'],
    });

    expect(reading.partial).toBe(true);
    expect(reading.vacancies).toHaveLength(2);
    expect(reading.vacancies[0]?.title).toBe('Senior Software Engineer');
    expect(reading.vacancies[0]?.company).toBe('Tech Corp');
    expect(reading.vacancies[1]?.title).toBe('Lead Frontend Developer');
    expect(reading.vacancies[1]?.company).toBe('StartupX');

    expect(scrapeJobsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ keywords: 'Software Engineer' }),
    );
    expect(scrapePostsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ keywords: '#hiring' }),
    );
  });

  it('integrates cleanly through buildMultiSourceFetcher', async () => {
    const sourceConfig: VacancySourceConfig = {
      id: LINKEDIN_CRAWLER_SOURCE_ID,
      name: 'LinkedIn (Obscura Crawler)',
      type: 'linkedin_crawler',
      enabled: true,
      targetUrl: 'https://www.linkedin.com/jobs/search',
      refreshIntervalMinutes: 60,
      itemsFoundTotal: 0,
      itemsActiveTotal: 0,
    };

    const pool = new LinkedinAccountPool({
      accountIds: ['acc-1'],
      storageRoot: '/tmp/test-crawlers/fetcher-pool',
    });

    const scraper = new LinkedinScraper({
      pool,
      navigator: async () => ({ status: 200, url: '', content: '' }),
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    vi.spyOn(scraper, 'scrapeJobs').mockResolvedValue({
      status: 'success',
      accountId: 'acc-1',
      vacancies: [dummyJobVacancy],
    });

    vi.spyOn(scraper, 'scrapePosts').mockResolvedValue({
      status: 'success',
      accountId: 'acc-1',
      vacancies: [],
    });

    const refuse = async () => {
      throw new Error('should not reach other platforms');
    };

    const fetcher = buildMultiSourceFetcher(
      refuse,
      refuse,
      undefined,
      {
        linkedinCrawlerDeps: {
          pool,
          scraper,
          keywords: ['Software Engineer'],
        },
      },
    );

    const result = await fetcher(sourceConfig);
    expect('vacancies' in result).toBe(true);
    if ('vacancies' in result) {
      expect(result.partial).toBe(true);
      expect(result.vacancies).toHaveLength(1);
      expect(result.vacancies[0]?.title).toBe('Senior Software Engineer');
    }
  });
});
