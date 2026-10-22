import { describe, expect, it, vi } from 'vitest';
import { fetchSitemapUrls } from './seo-sitemap-urls.mjs';

const origin = 'https://openqareer.com';
const urlset = (...urls) => `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${url}</loc></url>`).join('')}</urlset>`;
const index = (...urls) => `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<sitemap><loc>${url}</loc></sitemap>`).join('')}</sitemapindex>`;
function fixture(files) {
  return vi.fn(async url => new Response(files[url] ?? '', { status: url in files ? 200 : 404 }));
}

describe('sitemap URLs for Search Console inspection', () => {
  it('expands child maps and returns pages, never XML addresses', async () => {
    const fetcher = fixture({
      [`${origin}/sitemap.xml`]: index(`${origin}/sitemaps/static.xml`, `${origin}/sitemaps/jobs.xml`),
      [`${origin}/sitemaps/static.xml`]: urlset(`${origin}/`, `${origin}/faq`),
      [`${origin}/sitemaps/jobs.xml`]: urlset(`${origin}/vacancies/job/a`, `${origin}/faq`),
    });
    expect(await fetchSitemapUrls(`${origin}/sitemap.xml`, fetcher)).toEqual([
      `${origin}/`, `${origin}/faq`, `${origin}/vacancies/job/a`,
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('supports a plain urlset and decodes XML entities', async () => {
    const fetcher = fixture({ [`${origin}/sitemap.xml`]: urlset(`${origin}/vacancies?a=1&amp;b=2`) });
    expect(await fetchSitemapUrls(`${origin}/sitemap.xml`, fetcher)).toEqual([`${origin}/vacancies?a=1&b=2`]);
  });

  it('terminates cycles and repeated child references', async () => {
    const fetcher = fixture({ [`${origin}/sitemap.xml`]: index(`${origin}/sitemap.xml`) });
    expect(await fetchSitemapUrls(`${origin}/sitemap.xml`, fetcher)).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects a failed child instead of reporting a partial count', async () => {
    const fetcher = fixture({ [`${origin}/sitemap.xml`]: index(`${origin}/missing.xml`) });
    await expect(fetchSitemapUrls(`${origin}/sitemap.xml`, fetcher)).rejects.toThrow('HTTP 404');
  });

  it('rejects cross-origin child maps before fetching them', async () => {
    const fetcher = fixture({ [`${origin}/sitemap.xml`]: index('https://other.example/sitemap.xml') });
    await expect(fetchSitemapUrls(`${origin}/sitemap.xml`, fetcher)).rejects.toThrow('origin');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects HTML error pages served with status 200', async () => {
    const fetcher = fixture({ [`${origin}/sitemap.xml`]: '<html>error</html>' });
    await expect(fetchSitemapUrls(`${origin}/sitemap.xml`, fetcher)).rejects.toThrow('sitemap XML');
  });
});
