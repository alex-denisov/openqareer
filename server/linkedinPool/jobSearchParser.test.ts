import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { linkedinJobSearchUrl, parseLinkedinJobSearchPageHtml } from './jobSearchParser';

// Fixture is synthetic (see its header comment): parser verified on modelled markup.
const fixture = readFileSync(
  fileURLToPath(new URL('./fixtures/jobs-search-page.html', import.meta.url)),
  'utf8',
);

describe('parseLinkedinJobSearchPageHtml', () => {
  it('extracts id, title, company, location, url and date; skips broken and repeated cards', () => {
    expect(parseLinkedinJobSearchPageHtml(fixture)).toEqual([
      {
        jobId: '4012345678',
        title: 'Senior QA Engineer & Automation',
        company: 'Example Systems LLC',
        location: 'Dubai, United Arab Emirates (On-site)',
        url: 'https://www.linkedin.com/jobs/view/4012345678',
        publishedAt: '2026-11-01',
      },
      {
        jobId: '4012345679',
        title: 'Test Lead',
        company: 'Sample Corp',
        location: 'Abu Dhabi (Hybrid)',
        url: 'https://www.linkedin.com/jobs/view/4012345679',
      },
    ]);
  });

  it('returns nothing for pages without cards', () => {
    expect(parseLinkedinJobSearchPageHtml('<html><body>nothing</body></html>')).toEqual([]);
  });
});

describe('linkedinJobSearchUrl', () => {
  it('builds the week-fresh search url with encoded terms', () => {
    const url = new URL(linkedinJobSearchUrl('QA engineer', 'Abu Dhabi'));
    expect(url.origin + url.pathname).toBe('https://www.linkedin.com/jobs/search/');
    expect(url.searchParams.get('keywords')).toBe('QA engineer');
    expect(url.searchParams.get('location')).toBe('Abu Dhabi');
    expect(url.searchParams.get('f_TPR')).toBe('r604800');
  });
});
