import type { DatabaseSync } from 'node:sqlite';
import { readSalaryMarketIndex } from '../salaryMarket/salaryMarketSnapshot';
import { salaryRolePath } from '../../shared/salaryMarketPublic';
import type { SitemapUrl } from './sitemapXml';

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
  return urls;
}
