import { describe, expect, it } from 'vitest';
import { checkUrl, extractLocs, isSitemapIndex, parseRobotsDisallow } from './sitemapRules.mjs';

const U = 'https://openqareer.com/vacancies/x';
const page = (head) => `<html><head>${head}</head><body><meta name="robots" content="noindex"></body></html>`;
const ok = { url: U, status: 200, headers: {}, html: page(`<link rel="canonical" href="${U}">`) };

describe('checkUrl', () => {
  it('passes a clean page (body meta is ignored)', () => {
    expect(checkUrl(ok)).toEqual([]);
  });
  it('flags redirects and errors', () => {
    expect(checkUrl({ ...ok, status: 301, location: '/a' })).toEqual(['status 301 → /a']);
    expect(checkUrl({ ...ok, status: 410 })).toEqual(['status 410']);
  });
  it('flags noindex in header and meta', () => {
    expect(checkUrl({ ...ok, headers: { 'x-robots-tag': 'noindex' } })).toContain('X-Robots-Tag: noindex');
    const html = page(`<meta content="noindex, follow" name="robots"><link rel="canonical" href="${U}">`);
    expect(checkUrl({ ...ok, html })).toEqual(['meta robots noindex']);
  });
  it('requires an exact self canonical', () => {
    expect(checkUrl({ ...ok, html: page('') })).toEqual(['no canonical']);
    expect(checkUrl({ ...ok, html: page(`<link rel="canonical" href="${U}/">`) })).toEqual([`canonical → ${U}/`]);
  });
  it('flags query, /page/N and robots.txt', () => {
    const url = 'https://openqareer.com/app/page/2?after=1';
    const html = page(`<link rel="canonical" href="${url}">`);
    expect(checkUrl({ ...ok, url, html }, ['/app'])).toEqual([
      'query in URL',
      '/page/N in URL',
      'blocked by robots.txt',
    ]);
  });
});

describe('sitemap and robots parsing', () => {
  it('reads locs and index', () => {
    const xml = '<sitemapindex><sitemap><loc>https://a/x?a=1&amp;b=2</loc></sitemap></sitemapindex>';
    expect(isSitemapIndex(xml)).toBe(true);
    expect(extractLocs(xml)).toEqual(['https://a/x?a=1&b=2']);
  });
  it('reads disallow for the * group only', () => {
    const robots = 'User-agent: *\nAllow: /\nDisallow: /app\n\nUser-agent: Yandex\nDisallow: /y\n';
    expect(parseRobotsDisallow(robots)).toEqual(['/app']);
  });
});
