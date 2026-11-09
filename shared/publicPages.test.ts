import { describe, expect, it } from 'vitest';
import { buildLlmsFullTxt, buildLlmsTxt, llmsPages, SITE_ORIGIN } from './aeoSurface';
import { publicPages, salaryPublicPages, type PublicPage } from './publicPages';
import { staticSitemapUrls } from '../server/seo/sitemapXml';
import { RELOCATION_PLACE } from '../server/vacancies/catalogChips';

const report: PublicPage = {
  path: '/reports/rynok-vakansiy-2026-10',
  title: 'Рынок вакансий, октябрь 2026',
  description: 'Число вакансий, медианы зарплат по периодам, доля удалёнки и топ ролей.',
  updatedAt: '2026-11-01',
  group: 'Отчёты о рынке',
};

/** GEO gate: a sitemap address without a llms.txt line fails CI. */
describe('page registry → sitemap and llms.txt', () => {
  it('every static sitemap address is listed in llms.txt and llms-full.txt', () => {
    const short = buildLlmsTxt(undefined, [report]);
    const full = buildLlmsFullTxt(undefined, [report]);
    const urls = [...staticSitemapUrls('2026-11-01', [report]), ...salaryPublicPages()];
    for (const { path } of urls) {
      const url = `${SITE_ORIGIN}${path}`;
      expect(short, url).toContain(`(${url})`);
      expect(full, url).toContain(`(${url})`);
    }
  });

  it('every registry entry has a one-line description and a title', () => {
    for (const page of llmsPages([report])) {
      expect(page.title.trim(), page.path).not.toBe('');
      expect(page.description.trim().length, page.path).toBeGreaterThan(20);
      expect(page.description, page.path).not.toMatch(/\n/u);
    }
  });

  it('dates are ISO days and printed in llms.txt', () => {
    for (const page of publicPages().filter((row) => !row.datedByCatalog)) {
      expect(page.updatedAt, page.path).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    }
    expect(buildLlmsTxt()).toContain('Обновлено: ');
  });

  it('the relocation listing slug matches the catalog chip', () => {
    expect(publicPages().map((page) => page.path)).toContain(`/vacancies/${RELOCATION_PLACE}`);
  });

  it('paths are unique', () => {
    const paths = llmsPages().map((page) => page.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('database pages travel into the sitemap and llms.txt', () => {
    expect(staticSitemapUrls(undefined, [report]).map((url) => url.path)).toContain(report.path);
    expect(buildLlmsTxt(undefined, [report])).toContain('### Отчёты о рынке');
  });
});

describe('«Коротко» on every guide and blog post', () => {
  it('has 2–3 sentences answering the title', async () => {
    const { GUIDES } = await import('./guides');
    const { BLOG_POSTS } = await import('./blog');
    for (const item of [...GUIDES, ...BLOG_POSTS]) {
      expect(item.short, item.slug).toBeDefined();
      const sentences = item.short!.text.split(/(?<=[.!?])\s+/u).filter(Boolean);
      expect(sentences.length, item.slug).toBeGreaterThanOrEqual(2);
      expect(sentences.length, item.slug).toBeLessThanOrEqual(3);
      for (const row of item.short!.table?.rows ?? []) {
        expect(row.length, item.slug).toBe(item.short!.table!.head.length);
      }
    }
  });
});
