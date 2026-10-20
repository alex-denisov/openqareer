/**
 * Sitemap files of openqareer.com (SEO review, 20.10).
 *
 * `/sitemap.xml` is an index of three kinds of child files: permanent pages,
 * place/role listings, and the narrow set of indexable vacancy cards
 * (`catalogIndexing`). Deep catalog pages are not listed anywhere.
 */
import { SITE_ORIGIN } from '../../shared/aeoSurface';
import { LEGAL_DOCS, LEGAL_PACK_PUBLISHED_AT, legalPath } from '../../shared/legalRegistry';
import { CATALOG_ROOT } from '../../shared/vacancyCatalogRoutes';

/**
 * URLs per child file. The protocol allows 50 000 URLs and 10 MB; a card
 * address is up to ~250 characters, so 25 000 entries stay under ~8.5 MB even
 * in the worst case.
 */
export const SITEMAP_FILE_URL_LIMIT = 25_000;

export const STATIC_SITEMAP = 'sitemap-static.xml';
export const LISTINGS_SITEMAP = 'sitemap-listings.xml';

export function jobsSitemapName(index: number): string {
  return `sitemap-jobs-${index}.xml`;
}

export interface SitemapUrl {
  readonly path: string;
  /** `YYYY-MM-DD`; omitted when we have no honest modification date. */
  readonly lastmod?: string;
}

export interface SitemapFile {
  readonly name: string;
  readonly xml: string;
  readonly urlCount: number;
  readonly lastmod?: string;
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';
const NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9';

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

function lastmodTag(lastmod: string | undefined): string {
  return lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : '';
}

export function renderUrlset(urls: readonly SitemapUrl[]): string {
  const body = urls
    .map(
      (url) =>
        `  <url><loc>${escapeXml(`${SITE_ORIGIN}${url.path}`)}</loc>${lastmodTag(url.lastmod)}</url>`,
    )
    .join('\n');
  return `${XML_HEAD}<urlset xmlns="${NAMESPACE}">\n${body}\n</urlset>\n`;
}

export function renderSitemapIndex(
  files: readonly Pick<SitemapFile, 'name' | 'lastmod'>[],
): string {
  const body = files
    .map(
      (file) =>
        `  <sitemap><loc>${escapeXml(`${SITE_ORIGIN}/${file.name}`)}</loc>${lastmodTag(file.lastmod)}</sitemap>`,
    )
    .join('\n');
  return `${XML_HEAD}<sitemapindex xmlns="${NAMESPACE}">\n${body}\n</sitemapindex>\n`;
}

function newest(urls: readonly SitemapUrl[]): string | undefined {
  let best: string | undefined;
  for (const url of urls) {
    if (url.lastmod && (!best || url.lastmod > best)) best = url.lastmod;
  }
  return best;
}

function file(name: string, urls: readonly SitemapUrl[]): SitemapFile {
  const lastmod = newest(urls);
  return {
    name,
    xml: renderUrlset(urls),
    urlCount: urls.length,
    ...(lastmod ? { lastmod } : {}),
  };
}

export function staticSitemapUrls(): SitemapUrl[] {
  return [
    { path: '/' },
    // B535: help pages next to the landing.
    { path: '/faq' },
    { path: '/support' },
    ...LEGAL_DOCS.map((doc) => ({ path: legalPath(doc.slug), lastmod: LEGAL_PACK_PUBLISHED_AT })),
    { path: CATALOG_ROOT },
  ];
}

/**
 * All child files. A section with no URLs gets no file: an empty urlset is
 * rejected by Yandex Webmaster as an invalid sitemap.
 */
export function buildSitemapFiles(input: {
  readonly listings: readonly SitemapUrl[];
  readonly jobs: readonly SitemapUrl[];
}): SitemapFile[] {
  const files = [file(STATIC_SITEMAP, staticSitemapUrls())];
  const listings = input.listings.slice(0, SITEMAP_FILE_URL_LIMIT);
  if (listings.length > 0) files.push(file(LISTINGS_SITEMAP, listings));
  for (let start = 0; start < input.jobs.length; start += SITEMAP_FILE_URL_LIMIT) {
    const chunk = input.jobs.slice(start, start + SITEMAP_FILE_URL_LIMIT);
    files.push(file(jobsSitemapName(start / SITEMAP_FILE_URL_LIMIT + 1), chunk));
  }
  return files;
}
