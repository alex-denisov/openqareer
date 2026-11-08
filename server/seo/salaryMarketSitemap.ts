import type { DatabaseSync } from 'node:sqlite';
import { readSalaryMarketIndex } from '../salaryMarket/salaryMarketSnapshot';
import { salaryRolePath } from '../../shared/salaryMarketPublic';
import type { SitemapUrl } from './sitemapXml';
import { SALARY_COUNTRIES, SALARY_POOL_COUNTRIES } from '../../shared/salaryPublicPages';
import type { CountryCatalog } from '../../shared/salaryCountryCities';

/** Tax-calculator pages; their figures change with the rate year. */
const COUNTRY_LASTMOD = '2026-10-27';

/** Maintenance-only prepared directory, bounded to its published role cap. */
export function salaryMarketSitemapUrls(
  database: DatabaseSync,
  readCountry?: (code: string) => CountryCatalog | null,
): SitemapUrl[] {
  const entries = readSalaryMarketIndex(database).filter((entry) => entry.indexable);
  const urls = entries.flatMap((entry) => {
    const path = salaryRolePath(entry.role);
    return path ? [{ path, lastmod: entry.updatedAt.slice(0, 10) }] : [];
  });
  if (urls.length)
    urls.unshift({
      path: '/salaries',
      lastmod: urls
        .map((url) => url.lastmod)
        .sort()
        .at(-1)!,
    });
  if (!urls.length) return urls;
  return [
    ...urls,
    ...Object.keys(SALARY_COUNTRIES).map((slug) => ({
      path: `/salaries/${slug}`,
      lastmod: COUNTRY_LASTMOD,
    })),
    ...poolCountryUrls(readCountry),
  ];
}

/** SEO P2: pool-only country pages enter the sitemap only while their figure is published. */
function poolCountryUrls(readCountry?: (code: string) => CountryCatalog | null): SitemapUrl[] {
  if (!readCountry) return [];
  return Object.entries(SALARY_POOL_COUNTRIES).flatMap(([slug, country]) => {
    try {
      const pay = readCountry(country.code)?.pay;
      return pay ? [{ path: `/salaries/${slug}`, lastmod: pay.readAt.slice(0, 10) }] : [];
    } catch {
      return [];
    }
  });
}
