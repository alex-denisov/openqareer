/**
 * Sitemap files of openqareer.com (SEO review, 20.10).
 *
 * `/sitemap.xml` is an index of child files under `/sitemaps/`: permanent
 * pages, place/role listings, and the narrow set of indexable vacancy cards
 * (`catalogIndexing`). Deep catalog pages are not listed anywhere.
 */
import { SITE_ORIGIN } from '../../shared/aeoSurface';
import {
  INTERVIEW_EVIDENCE,
  INTERVIEW_HUB_PATH,
  interviewProfessionIndexable,
  interviewProfessionPath,
  publishedInterviewProfessions,
} from '../../shared/interviewQuestions';
import { publicPages, type PublicPage } from '../../shared/publicPages';

/**
 * URLs per child file. The site's working limit leaves headroom below the
 * protocol maximum of 50,000 URLs and 50 MB per sitemap.
 */
export const SITEMAP_FILE_URL_LIMIT = 10_000;

export const STATIC_SITEMAP = 'static-1.xml';
export const LISTINGS_SITEMAP = 'listings-1.xml';

export function jobsSitemapName(index: number): string {
  return `jobs-${index}.xml`;
}

export function listingsSitemapName(index: number): string {
  return `listings-${index}.xml`;
}

export interface SitemapUrl {
  readonly path: string;
  /** `YYYY-MM-DD`; omitted when we have no honest modification date. */
  readonly lastmod?: string;
  /** Stays in the file; only the Indexing API skips it (`searchRestrictedSources`). */
  readonly noIndexingApi?: true;
}

export interface SitemapFile {
  readonly name: string;
  readonly xml: string;
  readonly urlCount: number;
  readonly lastmod?: string;
  /** Present in a newly built maintenance snapshot; not needed by HTTP readers. */
  readonly urls?: readonly SitemapUrl[];
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
        `  <sitemap><loc>${escapeXml(`${SITE_ORIGIN}/sitemaps/${file.name}`)}</loc>${lastmodTag(file.lastmod)}</sitemap>`,
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
    urls,
    ...(lastmod ? { lastmod } : {}),
  };
}

export { PUBLIC_PAGES_UPDATED_AT } from '../../shared/publicPages';

/** B568: the hub and every reviewed profession; noindex professions stay out. */
export function interviewSitemapUrls(): SitemapUrl[] {
  const lastmod = INTERVIEW_EVIDENCE.measuredAt;
  return [
    { path: INTERVIEW_HUB_PATH, lastmod },
    ...publishedInterviewProfessions()
      .filter(interviewProfessionIndexable)
      .map((profession) => ({ path: interviewProfessionPath(profession.slug), lastmod })),
  ];
}

/**
 * GEO 09.11: permanent pages come from the one registry that also writes
 * llms.txt. `catalogLastmod` — the freshest listing date; the catalog root
 * changes with it. `extraPages` — database pages (monthly market reports).
 */
export function staticSitemapUrls(
  catalogLastmod?: string,
  extraPages: readonly PublicPage[] = [],
): SitemapUrl[] {
  const withDate = (page: PublicPage): SitemapUrl => {
    const lastmod = page.datedByCatalog ? catalogLastmod : page.updatedAt;
    return { path: page.path, ...(lastmod ? { lastmod } : {}) };
  };
  return [...publicPages().map(withDate), ...extraPages.map(withDate)];
}

/**
 * All child files. A section with no URLs gets no file: an empty urlset is
 * rejected by Yandex Webmaster as an invalid sitemap.
 */
export function buildSitemapFiles(input: {
  readonly listings: readonly SitemapUrl[];
  readonly jobs: readonly SitemapUrl[];
  readonly extraPages?: readonly PublicPage[];
}): SitemapFile[] {
  const files = [
    file(STATIC_SITEMAP, staticSitemapUrls(newest(input.listings), input.extraPages)),
  ];
  for (let start = 0; start < input.listings.length; start += SITEMAP_FILE_URL_LIMIT) {
    const chunk = input.listings.slice(start, start + SITEMAP_FILE_URL_LIMIT);
    files.push(file(listingsSitemapName(start / SITEMAP_FILE_URL_LIMIT + 1), chunk));
  }
  for (let start = 0; start < input.jobs.length; start += SITEMAP_FILE_URL_LIMIT) {
    const chunk = input.jobs.slice(start, start + SITEMAP_FILE_URL_LIMIT);
    files.push(file(jobsSitemapName(start / SITEMAP_FILE_URL_LIMIT + 1), chunk));
  }
  return files;
}
