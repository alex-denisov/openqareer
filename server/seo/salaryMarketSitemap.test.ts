import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { salaryMarketSitemapUrls } from './salaryMarketSitemap';
import { SALARY_MARKET_TABLE_SQL } from '../salaryMarket/salaryMarketSnapshot';

describe('salary sitemap publication', () => {
  it('does not publish a salary URL without a prepared index', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(SALARY_MARKET_TABLE_SQL);
    expect(salaryMarketSitemapUrls(db)).toEqual([]);
    db.close();
  });
  it('publishes only evidence-ready exact catalog paths and dated directory', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE salary_market_index (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
    db.prepare('INSERT INTO salary_market_index VALUES (1, ?)').run(
      JSON.stringify([
        {
          role: 'software-engineer',
          roleLabel: 'Engineer',
          sampleSize: 10,
          updatedAt: '2026-10-23T00:00:00Z',
          indexable: true,
        },
        {
          role: 'analyst',
          roleLabel: 'Analyst',
          sampleSize: 10,
          updatedAt: '2026-10-23T00:00:00Z',
          indexable: false,
        },
      ]),
    );
    expect(salaryMarketSitemapUrls(db)).toEqual([
      { path: '/salaries', lastmod: '2026-10-23' },
      { path: '/salaries/software-engineer', lastmod: '2026-10-23' },
      ...['cyprus', 'germany', 'uae', 'georgia', 'serbia'].map((slug) => ({
        path: `/salaries/${slug}`,
        lastmod: '2026-10-27',
      })),
    ]);
    db.close();
  });
});
