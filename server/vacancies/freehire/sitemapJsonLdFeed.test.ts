import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFeedClient, resetFeedHostBackoff } from './feedClient';
import { readJsonLdPostings } from './jsonLdPosting';
import {
  listSitemapBoard,
  readSitemap,
  resetSitemapCache,
  type SitemapBoard,
} from './sitemapJsonLdFeed';

const page = (ld: unknown) =>
  `<html><script type="application/ld+json">${JSON.stringify(ld)}</script></html>`;

const posting = (title: string) => ({
  '@type': 'JobPosting',
  title,
  hiringOrganization: { name: 'Acme' },
  datePosted: '2026-11-01',
  description: '<p>Python</p>',
  jobLocation: { address: { addressLocality: 'Москва', addressCountry: 'RU' } },
});

const board: SitemapBoard = {
  id: 'acme',
  name: 'Acme',
  company: 'Acme fallback',
  market: 'Россия',
  sitemapUrl: 'https://jobs.acme.ru/sitemap.xml',
  vacancyPattern: /\/vacancy\/(\d+)$/,
  maxNewPerSync: 2,
};

function site(files: Record<string, string | Uint8Array>, calls: string[] = []) {
  return createFeedClient({
    fetchImpl: (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      const body = files[url];
      return body === undefined ? new Response('', { status: 404 }) : new Response(typeof body === 'string' ? body : Buffer.from(body));
    }) as typeof fetch,
    sleep: async () => {},
  });
}

const ctx = { observedAt: '2026-11-10T00:00:00.000Z', sourceName: 'Acme' };

beforeEach(() => {
  resetSitemapCache();
  resetFeedHostBackoff();
});

describe('readJsonLdPostings', () => {
  it('finds a posting at top level, in an array, in @graph and under mainEntity', () => {
    const html = [
      page(posting('A')),
      page([{ '@type': 'Organization' }, posting('B')]),
      page({ '@graph': [posting('C')] }),
      page({ '@type': 'WebPage', mainEntity: posting('D') }),
      '<script type="application/ld+json">{broken</script>',
    ].join('');
    expect(readJsonLdPostings(html).map((p) => p.title)).toEqual(['A', 'B', 'C', 'D']);
    expect(readJsonLdPostings(page(posting('A')))[0]).toMatchObject({
      company: 'Acme',
      location: 'Москва, RU',
    });
  });
});

describe('readSitemap', () => {
  it('tells an index from a urlset and decodes CDATA and entities', () => {
    expect(
      readSitemap('<sitemapindex><sitemap><loc>https://a/x.xml</loc></sitemap></sitemapindex>'),
    ).toEqual({
      locs: ['https://a/x.xml'],
      isIndex: true,
    });
    expect(
      readSitemap('<urlset><url><loc><![CDATA[https://a/v?x=1&amp;y=2]]></loc></url></urlset>')
        .locs,
    ).toEqual(['https://a/v?x=1&y=2']);
  });
});

describe('listSitemapBoard', () => {
  const files = {
    'https://jobs.acme.ru/sitemap.xml':
      '<sitemapindex><sitemap><loc>https://jobs.acme.ru/s1.xml.gz</loc></sitemap><sitemap><loc>https://evil.example/s.xml</loc></sitemap></sitemapindex>',
    'https://jobs.acme.ru/s1.xml.gz': gzipSync(
      '<urlset><url><loc>https://jobs.acme.ru/vacancy/1</loc></url><url><loc>https://jobs.acme.ru/vacancy/2</loc></url><url><loc>https://jobs.acme.ru/vacancy/3</loc></url><url><loc>https://jobs.acme.ru/about</loc></url></urlset>',
    ),
    'https://jobs.acme.ru/vacancy/1': page(posting('One')),
    'https://jobs.acme.ru/vacancy/2': page(posting('Two')),
    'https://jobs.acme.ru/vacancy/3': page(posting('Three')),
  };

  it('reads at most maxNewPerSync pages, then the rest on the next poll', async () => {
    const calls: string[] = [];
    const client = site(files, calls);
    const first = await listSitemapBoard(client, board, ctx, 'src-fh-acme', () => 0.5);
    expect(first.vacancies).toHaveLength(2);
    expect(first.partial).toBe(true);
    expect(calls.some((u) => u.includes('evil.example'))).toBe(false);
    const second = await listSitemapBoard(client, board, ctx, 'src-fh-acme', () => 0.5);
    expect(second.vacancies.map((v) => v.title).sort()).toEqual(['One', 'Three', 'Two']);
    expect(second.partial).toBe(false);
    expect(second.vacancies[0]).toMatchObject({ company: 'Acme', location: 'Москва, RU' });
  });

  it('drops a vacancy that left the sitemap and does not re-read cached pages', async () => {
    const calls: string[] = [];
    await listSitemapBoard(site(files), { ...board, maxNewPerSync: 10 }, ctx, 'src-fh-acme');
    const shrunk = {
      ...files,
      'https://jobs.acme.ru/s1.xml.gz': gzipSync(
        '<urlset><url><loc>https://jobs.acme.ru/vacancy/1</loc></url></urlset>',
      ),
    };
    const reading = await listSitemapBoard(site(shrunk, calls), board, ctx, 'src-fh-acme');
    expect(reading.vacancies.map((v) => v.title)).toEqual(['One']);
    expect(calls.filter((u) => u.includes('/vacancy/'))).toEqual([]);
  });

  it('does not re-read a page without JobPosting on every poll', async () => {
    const calls: string[] = [];
    const noLd = { ...files, 'https://jobs.acme.ru/vacancy/3': '<html>no markup</html>' };
    const wide = { ...board, maxNewPerSync: 10 };
    await listSitemapBoard(site(noLd), wide, ctx, 'src-fh-acme');
    const again = await listSitemapBoard(site(noLd, calls), wide, ctx, 'src-fh-acme');
    expect(again.vacancies).toHaveLength(2);
    expect(again.partial).toBe(false);
    expect(calls.filter((u) => u.includes('/vacancy/'))).toEqual([]);
  });

  it('a sitemap without vacancies is a source failure, not an empty success', async () => {
    const client = site({ 'https://jobs.acme.ru/sitemap.xml': '<urlset></urlset>' });
    await expect(listSitemapBoard(client, board, ctx, 'src-fh-acme')).rejects.toThrow(
      'no vacancies',
    );
  });
});
