import type { DatabaseSync } from 'node:sqlite';
import { readSalaryMarketIndex } from '../salaryMarket/salaryMarketSnapshot';
import { salaryRolePath } from '../../shared/salaryMarketPublic';
import type { SitemapUrl } from './sitemapXml';
import { SALARY_COUNTRIES } from '../../shared/salaryPublicPages';

/** Tax-calculator pages; their figures change with the rate year. */
const COUNTRY_LASTMOD = '2026-10-27';

/** Maintenance-only prepared directory, bounded to its published role cap. */
export function salaryMarketSitemapUrls(database: DatabaseSync): SitemapUrl[] {
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
  ];
}
