import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { VACANCY_CATALOG_ENTRIES_TABLE } from '../data/sqliteSchema';
import {
  computeCatalogSitemaps,
  readCatalogSitemaps,
  writeCatalogSitemaps,
} from './catalogSitemapJob';
import {
  SITEMAP_FILE_URL_LIMIT,
  buildSitemapFiles,
  renderSitemapIndex,
  renderUrlset,
} from './sitemapXml';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const DAY = 86_400_000;

function iso(daysAgo: number): string {
  return new Date(NOW.getTime() - daysAgo * DAY).toISOString();
}

interface Row {
  id: string;
  title?: string;
  company?: string;
  salary?: string | null;
  role?: string | null;
  place?: string | null;
  status?: 'active' | 'archived';
  posted?: number;
  seen?: number;
}

function database(rows: readonly Row[]): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(VACANCY_CATALOG_ENTRIES_TABLE);
  const insert = db.prepare(
    `INSERT INTO catalog_entries (
       cluster_id, entry_key, path, title, company, location, is_remote, salary_label, summary,
       skills_json, source_url, source_name, published_at, last_seen_at, source_count, status,
       place_slug, place_label, role_slug, role_label, published_ms, last_seen_ms
     ) VALUES (?, ?, ?, ?, ?, NULL, 0, ?, '', '[]', 'https://x', NULL, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    const posted = iso(row.posted ?? 1);
    const seen = iso(row.seen ?? 0);
    const role = row.role === undefined ? 'frontend-developer' : row.role;
    const place = row.place === undefined ? 'berlin' : row.place;
    insert.run(
      `cluster-${row.id}`,
      row.id,
      `/vacancies/job/frontend-developer-at-acme-${row.id}`,
      row.title ?? 'Frontend Developer',
      row.company ?? 'Acme',
      row.salary === undefined ? '5 000 USD' : row.salary,
      posted,
      seen,
      row.status ?? 'active',
      place,
      place ? 'Berlin' : null,
      role,
      role ? 'Frontend Developer' : null,
      Date.parse(posted),
      Date.parse(seen),
    );
  }
  return db;
}

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1] ?? '');
}

describe('computeCatalogSitemaps', () => {
  it('splits the sitemap into static, listings and job files', () => {
    const files = computeCatalogSitemaps(database([{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]), NOW);
    expect(files.map((file) => file.name)).toEqual([
      'sitemap-static.xml',
      'sitemap-listings.xml',
      'sitemap-jobs-1.xml',
    ]);
  });

  it('keeps only fresh, salaried, named, English-role cards in the job files', () => {
    const files = computeCatalogSitemaps(
      database([
        { id: 'good' },
        { id: 'nosalary', salary: null },
        { id: 'nocompany', company: ' ' },
        { id: 'norole', role: null },
        { id: 'stale', seen: 20 },
        { id: 'old', posted: 30 },
        { id: 'gone', status: 'archived' },
      ]),
      NOW,
    );
    const jobs = files.find((file) => file.name === 'sitemap-jobs-1.xml')!;
    expect(locs(jobs.xml)).toEqual([
      'https://openqareer.com/vacancies/job/frontend-developer-at-acme-good',
    ]);
    expect(jobs.urlCount).toBe(1);
  });

  it('gives each listing the date of its freshest vacancy', () => {
    const files = computeCatalogSitemaps(
      database([
        { id: 'b1', posted: 5 },
        { id: 'b2', posted: 2 },
        { id: 'b3', posted: 9, salary: null },
        { id: 'one', place: 'paris' },
      ]),
      NOW,
    );
    const listings = files.find((file) => file.name === 'sitemap-listings.xml')!;
    expect(listings.xml).toContain(
      `<url><loc>https://openqareer.com/vacancies/berlin</loc><lastmod>${iso(2).slice(0, 10)}</lastmod></url>`,
    );
    expect(listings.xml).toContain(
      '<loc>https://openqareer.com/vacancies/berlin/frontend-developer</loc>',
    );
    // A one-vacancy place is below the publishing threshold, as on the page itself.
    expect(listings.xml).not.toContain('/vacancies/paris');
    expect(listings.lastmod).toBe(iso(2).slice(0, 10));
  });

  it('never lists withdrawn vacancies or deep catalog pages', () => {
    const files = computeCatalogSitemaps(database([{ id: 'gone', status: 'archived' }]), NOW);
    const all = files.flatMap((file) => locs(file.xml));
    expect(all.some((loc) => loc.includes('gone'))).toBe(false);
    expect(all.some((loc) => loc.includes('/page/'))).toBe(false);
    // No job file when nothing qualifies: an empty urlset is not a valid child.
    expect(files.map((file) => file.name)).not.toContain('sitemap-jobs-1.xml');
  });
});

describe('buildSitemapFiles', () => {
  it('lists the landing, help pages, legal documents and the catalog root in the static file', () => {
    const [staticFile] = buildSitemapFiles({ listings: [], jobs: [] });
    const urls = locs(staticFile!.xml);
    expect(urls).toContain('https://openqareer.com/');
    expect(urls).toContain('https://openqareer.com/faq');
    expect(urls).toContain('https://openqareer.com/support');
    expect(urls).toContain('https://openqareer.com/legal/privacy');
    expect(urls).toContain('https://openqareer.com/vacancies');
    expect(urls).toHaveLength(8);
  });

  it('chunks job files under the per-file URL limit', () => {
    const jobs = Array.from({ length: SITEMAP_FILE_URL_LIMIT + 1 }, (_, index) => ({
      path: `/vacancies/job/frontend-developer-${index}`,
      lastmod: '2026-10-19',
    }));
    const files = buildSitemapFiles({ listings: [], jobs });
    const jobFiles = files.filter((file) => file.name.startsWith('sitemap-jobs-'));
    expect(jobFiles.map((file) => [file.name, file.urlCount])).toEqual([
      ['sitemap-jobs-1.xml', SITEMAP_FILE_URL_LIMIT],
      ['sitemap-jobs-2.xml', 1],
    ]);
    // 50 000 URLs and 10 MB are the protocol limits; the chunk keeps well under both.
    expect(SITEMAP_FILE_URL_LIMIT).toBeLessThanOrEqual(50_000);
    expect(Buffer.byteLength(jobFiles[0]!.xml)).toBeLessThan(10 * 1024 * 1024);
  });
});

describe('sitemap XML', () => {
  it('renders a urlset and an index that point at absolute URLs', () => {
    const urlset = renderUrlset([{ path: '/faq', lastmod: '2026-10-01' }]);
    expect(urlset.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(urlset).toContain(
      '<url><loc>https://openqareer.com/faq</loc><lastmod>2026-10-01</lastmod></url>',
    );
    const index = renderSitemapIndex([
      { name: 'sitemap-static.xml', lastmod: '2026-10-01' },
      { name: 'sitemap-jobs-1.xml' },
    ]);
    expect(index).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(index).toContain(
      '<sitemap><loc>https://openqareer.com/sitemap-static.xml</loc><lastmod>2026-10-01</lastmod></sitemap>',
    );
    expect(index).toContain(
      '<sitemap><loc>https://openqareer.com/sitemap-jobs-1.xml</loc></sitemap>',
    );
  });

  it('escapes XML-special characters in addresses', () => {
    expect(renderUrlset([{ path: '/a?b=1&c=2' }])).toContain('/a?b=1&amp;c=2');
  });
});

describe('address policy', () => {
  it('lists only addresses that pass the owner address rule', async () => {
    const { publicPathViolation } = await import('../../shared/seoSlugPolicy');
    const files = computeCatalogSitemaps(database([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]), NOW);
    for (const loc of files.flatMap((file) => locs(file.xml))) {
      expect(publicPathViolation(new URL(loc).pathname), loc).toBeNull();
    }
  });
});

describe('catalog_sitemaps storage', () => {
  it('replaces the stored files as a whole and reads them back', () => {
    const db = database([{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]);
    expect(readCatalogSitemaps(db)).toBeNull();
    writeCatalogSitemaps(db, computeCatalogSitemaps(db, NOW), NOW);
    expect(readCatalogSitemaps(db)?.map((file) => file.name)).toEqual([
      'sitemap-static.xml',
      'sitemap-listings.xml',
      'sitemap-jobs-1.xml',
    ]);
    writeCatalogSitemaps(db, buildSitemapFiles({ listings: [], jobs: [] }), NOW);
    expect(readCatalogSitemaps(db)?.map((file) => file.name)).toEqual(['sitemap-static.xml']);
  });
});
