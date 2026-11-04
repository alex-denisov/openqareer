import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { CATALOG_RU_SUMMARY_VERSION } from './catalogRuSummary';
import { CatalogRuSummaryStore } from './catalogRuSummaryStore';
import { VACANCY_CATALOG_ENTRIES_TABLE, VACANCY_CLUSTERS_TABLE } from '../data/sqliteSchema';
import { INDEXED_PLACE_MIN, INDEXED_PLACE_ROLE_MIN, LISTING_RETAIN_DAYS } from './catalogIndexing';
import { readListingHistory } from './catalogListingHistory';
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
  summary?: string;
}

const JOB_TEXT = 'Build and run the hiring product. '.repeat(4);

function database(rows: readonly Row[]): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(VACANCY_CATALOG_ENTRIES_TABLE);
  const insert = db.prepare(
    `INSERT INTO catalog_entries (
       cluster_id, entry_key, path, title, company, location, is_remote, salary_label, summary,
       skills_json, source_url, source_name, published_at, last_seen_at, source_count, status,
       place_slug, place_label, role_slug, role_label, published_ms, last_seen_ms
     ) VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?, '[]', 'https://x', NULL, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
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
      row.summary ?? JOB_TEXT,
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

/** Enough Berlin rows to pass the indexed-place threshold (`INDEXED_PLACE_MIN`). */
function berlinRows(prefix: string, posted = 6): Row[] {
  return Array.from({ length: INDEXED_PLACE_MIN }, (_, index) => ({
    id: `${prefix}${index}`,
    posted,
  }));
}

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1] ?? '');
}

/** Parses the renderer's deliberately small XML vocabulary and checks well-formed nesting. */
function parseSitemapXml(xml: string): string {
  const tokens = xml.match(/<\?xml[^?]*\?>|<\/?[A-Za-z][^>]*>|[^<]+/gu) ?? [];
  expect(tokens.join('')).toBe(xml);
  const stack: string[] = [];
  let root = '';
  for (const token of tokens) {
    if (token.startsWith('<?xml')) continue;
    if (!token.startsWith('<')) continue;
    const closing = /^<\/([A-Za-z][\w]*)>$/u.exec(token);
    if (closing) {
      expect(stack.pop()).toBe(closing[1]);
      continue;
    }
    const opening = /^<([A-Za-z][\w]*)(?:\s[^>]*)?>$/u.exec(token);
    expect(opening).toBeTruthy();
    if (!opening) continue;
    if (!root) root = opening[1] ?? '';
    if (!token.endsWith('/>')) stack.push(opening[1] ?? '');
  }
  expect(stack).toEqual([]);
  return root;
}

describe('source restrictions in the jobs sitemap', () => {
  function withCluster(db: DatabaseSync, id: string, sourceIds: readonly string[]): void {
    db.exec(VACANCY_CLUSTERS_TABLE);
    db.prepare(
      `INSERT INTO vacancy_clusters (id, fingerprint, title, company, cluster_json, items_count, updated_at)
       VALUES (?, ?, 't', 'c', ?, 1, 0)`,
    ).run(
      `cluster-${id}`,
      id,
      JSON.stringify({ sources: sourceIds.map((sourceId) => ({ sourceType: 'x', sourceId })) }),
    );
  }

  it('keeps a restricted card in the file and marks it for the Indexing API only', () => {
    const db = database([{ id: 'hima' }, { id: 'pair' }, { id: 'free' }, { id: 'unknown' }]);
    withCluster(db, 'hima', ['src-himalayas-api']);
    withCluster(db, 'pair', ['src-indeed', 'src-himalayas']);
    withCluster(db, 'free', ['src-indeed']);

    const jobs = computeCatalogSitemaps(db, NOW).find((file) => file.name === 'jobs-1.xml')!;

    expect(jobs.urlCount).toBe(4);
    expect(locs(jobs.xml)).toHaveLength(4);
    const marked = (jobs.urls ?? [])
      .filter((url) => url.noIndexingApi)
      .map((url) => url.path.split('-').pop());
    // A card whose cluster row is missing cannot be shown to be free of the restriction.
    expect(marked.sort()).toEqual(['hima', 'pair', 'unknown']);
    db.close();
  });
});

describe('computeCatalogSitemaps', () => {
  it('splits the sitemap into static, listings and job files', () => {
    const files = computeCatalogSitemaps(database(berlinRows('a')), NOW);
    expect(files.map((file) => file.name)).toEqual([
      'static-1.xml',
      'listings-1.xml',
      'jobs-1.xml',
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
        { id: 'zero', salary: '0 $' },
        { id: 'gone', status: 'archived' },
        { id: 'notext', summary: '' },
        { id: 'titleonly', summary: 'Бухгалтер' },
      ]),
      NOW,
    );
    const jobs = files.find((file) => file.name === 'jobs-1.xml')!;
    expect(locs(jobs.xml)).toEqual([
      'https://openqareer.com/vacancies/job/frontend-developer-at-acme-good',
    ]);
    expect(jobs.urlCount).toBe(1);
  });

  it('lists a card without a snippet once it has a Russian summary of the current version (03.11)', () => {
    const db = database([
      { id: 'hh', summary: '' },
      { id: 'hhold', summary: '' },
    ]);
    const store = new CatalogRuSummaryStore(db);
    store.ensureTable();
    const summary = { text: 'Первое. Второе.', facts: {} };
    store.saveReady('cluster-hh', 'hash', CATALOG_RU_SUMMARY_VERSION, summary, 'm', NOW.getTime());
    store.saveReady(
      'cluster-hhold',
      'hash',
      CATALOG_RU_SUMMARY_VERSION - 1,
      summary,
      'm',
      NOW.getTime(),
    );
    const jobs = computeCatalogSitemaps(db, NOW).find((file) => file.name === 'jobs-1.xml')!;
    expect(locs(jobs.xml)).toEqual([
      'https://openqareer.com/vacancies/job/frontend-developer-at-acme-hh',
    ]);
  });

  it('keeps a live card listed past its first week (03.11)', () => {
    const files = computeCatalogSitemaps(database([{ id: 'old', posted: 30, seen: 1 }]), NOW);
    const jobs = files.find((file) => file.name === 'jobs-1.xml')!;
    expect(locs(jobs.xml)).toEqual([
      'https://openqareer.com/vacancies/job/frontend-developer-at-acme-old',
    ]);
  });

  it('keeps a once-indexed listing for 30 days while it has a vacancy', () => {
    const db = database([
      ...Array.from({ length: INDEXED_PLACE_ROLE_MIN }, (_, index) => ({
        id: `m${index}`,
        place: 'minsk',
        role: 'business-analyst',
      })),
    ]);
    const role = 'https://openqareer.com/vacancies/minsk/business-analyst';
    const listed = (now: Date) =>
      computeCatalogSitemaps(db, now).flatMap((file) =>
        file.name.startsWith('listings') ? locs(file.xml) : [],
      );
    expect(listed(NOW)).toContain(role);
    db.exec("DELETE FROM catalog_entries WHERE entry_key IN ('m0', 'm1', 'm2', 'm3')");
    expect(listed(new Date(NOW.getTime() + 10 * DAY))).toContain(role);
    expect(listed(new Date(NOW.getTime() + (LISTING_RETAIN_DAYS + 1) * DAY))).not.toContain(role);
    db.exec("DELETE FROM catalog_entries WHERE entry_key = 'm4'");
    expect(listed(new Date(NOW.getTime() + DAY))).not.toContain(role);
  });

  it('remembers published listings and when they last qualified', () => {
    const db = database([
      ...berlinRows('h'),
      { id: 'p1', place: 'paris', role: null },
      { id: 'p2', place: 'paris', role: null },
      { id: 'p3', place: 'paris', role: null },
      { id: 'one', place: 'oslo', role: null },
    ]);
    computeCatalogSitemaps(db, NOW);
    const history = readListingHistory(db);
    expect(history.get('berlin/')).toEqual({
      firstQualifiedAt: NOW.toISOString(),
      lastQualifiedAt: NOW.toISOString(),
    });
    expect(history.get('paris/')).toEqual({});
    // Never published (below MIN_LISTING_SIZE): its path never existed for crawlers.
    expect(history.has('oslo/')).toBe(false);
  });

  it('gives each listing the date of its freshest vacancy', () => {
    const files = computeCatalogSitemaps(
      database([
        { id: 'b1', posted: 5 },
        { id: 'b2', posted: 2 },
        { id: 'b3', posted: 9, salary: null },
        ...berlinRows('bb'),
        { id: 'one', place: 'paris' },
      ]),
      NOW,
    );
    const listings = files.find((file) => file.name === 'listings-1.xml')!;
    expect(listings.xml).toContain(
      `<url><loc>https://openqareer.com/vacancies/berlin</loc><lastmod>${iso(2).slice(0, 10)}</lastmod></url>`,
    );
    expect(listings.xml).toContain(
      '<loc>https://openqareer.com/vacancies/berlin/frontend-developer</loc>',
    );
    // A one-vacancy place is below the indexing threshold, as on the page itself.
    expect(listings.xml).not.toContain('/vacancies/paris');
    expect(listings.lastmod).toBe(iso(2).slice(0, 10));
  });

  it('never lists withdrawn vacancies or deep catalog pages', () => {
    const files = computeCatalogSitemaps(database([{ id: 'gone', status: 'archived' }]), NOW);
    const all = files.flatMap((file) => locs(file.xml));
    expect(all.some((loc) => loc.includes('gone'))).toBe(false);
    expect(all.some((loc) => loc.includes('/page/'))).toBe(false);
    // No job file when nothing qualifies: an empty urlset is not a valid child.
    expect(files.map((file) => file.name)).not.toContain('jobs-1.xml');
  });
});

describe('buildSitemapFiles', () => {
  it('lists the landing, help pages, legal documents and the catalog root in the static file', () => {
    const [staticFile] = buildSitemapFiles({ listings: [], jobs: [] });
    const urls = locs(staticFile!.xml);
    expect(urls).toContain('https://openqareer.com/');
    expect(urls).toContain('https://openqareer.com/faq');
    expect(urls).toContain('https://openqareer.com/support');
    expect(urls).toContain('https://openqareer.com/tariffs');
    expect(urls).toContain('https://openqareer.com/legal/privacy');
    expect(urls).toContain('https://openqareer.com/vacancies');
    expect(urls).toContain('https://openqareer.com/tools/country-fit');
    expect(urls).toContain('https://openqareer.com/tools/resume');
    // B574: the calculator and the relocation list answer 200 and belong in the map.
    expect(urls).toContain('https://openqareer.com/tools/salary-calculator');
    expect(urls).toContain('https://openqareer.com/vacancies/relocation');
    expect(urls).toContain('https://openqareer.com/tools/relocation');
    // B568: the interview hub and six reviewed professions.
    expect(urls).toContain('https://openqareer.com/tools/interview-questions');
    expect(urls).toContain('https://openqareer.com/tools/interview-questions/accountant');
    expect(urls).toHaveLength(21);
  });

  it('splits 0, 1, 10,000, 10,001 and 25,000 URLs without truncation', () => {
    for (const count of [0, 1, 10_000, 10_001, 25_000]) {
      const jobs = Array.from({ length: count }, (_, index) => ({
        path: `/vacancies/job/frontend-developer-${index}`,
        lastmod: index < SITEMAP_FILE_URL_LIMIT ? '2026-10-19' : '2026-10-20',
      }));
      const files = buildSitemapFiles({ listings: [], jobs });
      const jobFiles = files.filter((file) => file.name.startsWith('jobs-'));
      expect(jobFiles.reduce((sum, file) => sum + file.urlCount, 0)).toBe(count);
      expect(jobFiles.every((file) => file.urlCount <= 10_000)).toBe(true);
      expect(jobFiles.map((file) => file.urlCount)).toEqual(
        count === 0
          ? []
          : Array.from({ length: Math.ceil(count / 10_000) }, (_, index) =>
              Math.min(10_000, count - index * 10_000),
            ),
      );
      expect(jobFiles.map((file) => file.name)).toEqual(
        jobFiles.map((_, index) => `jobs-${index + 1}.xml`),
      );
    }
    expect(SITEMAP_FILE_URL_LIMIT).toBe(10_000);
  });

  it('chunks every listing and gives each child its maximum URL lastmod', () => {
    const listings = Array.from({ length: 10_001 }, (_, index) => ({
      path: `/vacancies/place-${index}`,
      lastmod: index === 0 ? '2026-10-20' : '2026-10-19',
    }));
    const files = buildSitemapFiles({ listings, jobs: [] });
    const listingFiles = files.filter((file) => file.name.startsWith('listings-'));
    expect(listingFiles.map((file) => [file.name, file.urlCount, file.lastmod])).toEqual([
      ['listings-1.xml', 10_000, '2026-10-20'],
      ['listings-2.xml', 1, '2026-10-19'],
    ]);
  });

  it('parses the sitemap index and every child as well-formed namespaced XML', () => {
    const files = buildSitemapFiles({
      listings: [{ path: '/vacancies/berlin', lastmod: '2026-10-19' }],
      jobs: [{ path: '/vacancies/job/role', lastmod: '2026-10-20' }],
    });
    const index = renderSitemapIndex(files);
    expect(parseSitemapXml(index)).toBe('sitemapindex');
    expect(index).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    for (const file of files) {
      expect(parseSitemapXml(file.xml)).toBe('urlset');
      expect(file.urlCount).toBeLessThanOrEqual(10_000);
    }
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
      { name: 'static-1.xml', lastmod: '2026-10-01' },
      { name: 'jobs-1.xml' },
    ]);
    expect(index).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(index).toContain(
      '<sitemap><loc>https://openqareer.com/sitemaps/static-1.xml</loc><lastmod>2026-10-01</lastmod></sitemap>',
    );
    expect(index).toContain(
      '<sitemap><loc>https://openqareer.com/sitemaps/jobs-1.xml</loc></sitemap>',
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
    const db = database(berlinRows('a'));
    expect(readCatalogSitemaps(db)).toBeNull();
    writeCatalogSitemaps(db, computeCatalogSitemaps(db, NOW), NOW);
    expect(readCatalogSitemaps(db)?.map((file) => file.name)).toEqual([
      'static-1.xml',
      'listings-1.xml',
      'jobs-1.xml',
    ]);
    writeCatalogSitemaps(db, buildSitemapFiles({ listings: [], jobs: [] }), NOW);
    expect(readCatalogSitemaps(db)?.map((file) => file.name)).toEqual(['static-1.xml']);
  });
});
