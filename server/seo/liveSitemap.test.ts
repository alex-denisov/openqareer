import { describe, expect, it } from 'vitest';
import { liveJobsXml } from './liveSitemap';
import { renderUrlset } from './sitemapXml';

const xml = renderUrlset([
  { path: '/vacancies/job/a-at-x-k1', lastmod: '2026-11-10' },
  { path: '/vacancies/job/old-slug-at-x-k2', lastmod: '2026-11-10' },
  { path: '/vacancies/job/gone-at-x-k3', lastmod: '2026-11-10' },
]);

describe('liveJobsXml (11.11)', () => {
  it('drops closed cards and follows a moved slug to the current path', () => {
    const paths: Record<string, string> = {
      k1: '/vacancies/job/a-at-x-k1',
      k2: '/vacancies/job/new-slug-at-x-k2',
    };
    const out = liveJobsXml(xml, (key) => paths[key]);
    expect(out).toContain('<loc>https://openqareer.com/vacancies/job/a-at-x-k1</loc>');
    expect(out).toContain('<loc>https://openqareer.com/vacancies/job/new-slug-at-x-k2</loc>');
    expect(out).not.toContain('old-slug');
    expect(out).not.toContain('gone-at-x-k3');
    expect(out).toContain('<lastmod>2026-11-10</lastmod>');
  });
});
