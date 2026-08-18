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

  it('imports hh.ru resume content when public resume page is available', async () => {
    const sampleHtml = `
      <div data-qa="resume-personal-name">Алексей Денисов</div>
      <div data-qa="resume-block-title-position">Engineering Lead</div>
      <div data-qa="resume-block-skills-content">
        <span data-qa="bloko-tag__text">TypeScript</span>
        <span data-qa="bloko-tag__text">React</span>
      </div>
    `;
    const result = await importProfileUrl('https://hh.ru/resume/synthetic-token', {
      fetchImpl: async () => new Response(sampleHtml, { status: 200 }),
    });

    expect(result.status).toBe('imported');
    if (result.status === 'imported') {
      expect(result.platform).toBe('hh');
      expect(result.facts.some((f) => f.value === 'Engineering Lead')).toBe(true);
      expect(result.parsedResume?.skills).toContain('TypeScript');
    }
  });

  it('handles unavailable/authwalled hh.ru resume gracefully', async () => {
    const result = await importProfileUrl('https://hh.ru/resume/private-token', {
      fetchImpl: async () => new Response('Access denied', { status: 403 }),
    });

    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.reason).toBe('authwall');
    }
  });

  it('rejects non-HTTPS, non-profile and lookalike hosts', () => {
    expect(() => parseProfileUrl('http://linkedin.com/in/example')).toThrow('profile_url_invalid');
    expect(() => parseProfileUrl('https://linkedin.com.evil.test/in/example')).toThrow('profile_url_invalid');
    expect(() => parseProfileUrl('https://hh.ru/vacancy/123')).toThrow('profile_url_invalid');
  });
});
