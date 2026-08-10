import { describe, expect, it } from 'vitest';
import { importProfileUrl, parseProfileUrl } from './profileUrlImport';

describe('bounded profile URL import', () => {
  it('does not crawl LinkedIn without explicit platform permission', async () => {
    let fetched = false;
    const result = await importProfileUrl('https://www.linkedin.com/in/synthetic-candidate', {
      fetchImpl: async () => {
        fetched = true;
        return new Response('<meta property="og:title" content="Synthetic Product Lead">');
      },
    });

    expect(fetched).toBe(false);
    expect(result).toMatchObject({
      status: 'unavailable',
      platform: 'linkedin',
      reason: 'official-access-required',
      nextAction: 'oauth_or_export',
    });
  });

  it('routes hh.ru resumes to its official OAuth/API instead of page scraping', async () => {
    let fetched = false;
    const result = await importProfileUrl('https://hh.ru/resume/synthetic-token', {
      fetchImpl: async () => {
        fetched = true;
        return new Response('<meta property="og:title" content="Synthetic Resume">');
      },
    });

    expect(fetched).toBe(false);
    expect(result).toMatchObject({
      status: 'unavailable',
      platform: 'hh',
      reason: 'official-access-required',
      nextAction: 'oauth_or_export',
    });
  });

  it('rejects non-HTTPS, non-profile and lookalike hosts', () => {
    expect(() => parseProfileUrl('http://linkedin.com/in/example')).toThrow('profile_url_invalid');
    expect(() => parseProfileUrl('https://linkedin.com.evil.test/in/example')).toThrow('profile_url_invalid');
    expect(() => parseProfileUrl('https://hh.ru/vacancy/123')).toThrow('profile_url_invalid');
  });
});
