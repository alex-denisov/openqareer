/** Expand the site's sitemap index before selecting pages for URL Inspection. */
function parseSitemapUrls(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/giu)].map((match) =>
    match[1].replace(/&(amp|lt|gt|quot|apos);/gu, (_, entity) =>
      ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity],
    ),
  );
}

export async function fetchSitemapUrls(sitemapUrl, fetcher = fetch) {
  const origin = new URL(sitemapUrl).origin;
  const pending = [sitemapUrl];
  const visited = new Set();
  const pages = new Set();
  while (pending.length > 0) {
    const url = pending.shift();
    if (visited.has(url)) continue;
    if (new URL(url).origin !== origin) throw new Error('sitemap origin mismatch');
    if (visited.size >= 2000) throw new Error('sitemap file limit exceeded');
    visited.add(url);
    const response = await fetcher(url, {
      headers: { 'User-Agent': 'openqareer-seo-audit/1.0' },
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`sitemap fetch HTTP ${response.status}`);
    const xml = await response.text();
    const urls = parseSitemapUrls(xml);
    if (/<sitemapindex(?:\s|>)/u.test(xml)) pending.push(...urls);
    else if (/<urlset(?:\s|>)/u.test(xml)) urls.forEach(page => pages.add(page));
    else throw new Error('expected sitemap XML');
  }
  return [...pages];
}
