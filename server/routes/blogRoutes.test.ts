import Fastify from 'fastify';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BLOG_POSTS as GUIDES, blogPath as guidePath } from '../../shared/blog';
import { SALARY_MARKET_TEMPLATE } from '../../src/features/site/SalaryMarketPage';
import { registerBlogRoutes } from './blogRoutes';

const TEMPLATE =
  '<html><head><title>x</title><meta name="description" content="x"><link rel="canonical" href="x">' +
  '<meta property="og:url" content="x"><meta property="og:title" content="x"><meta property="og:image" content="x">' +
  '</head><body>%%SALARY_CONTENT%%</body></html>';

async function app() {
  const root = mkdtempSync(join(tmpdir(), 'blog-'));
  writeFileSync(join(root, SALARY_MARKET_TEMPLATE), TEMPLATE);
  const server = Fastify();
  registerBlogRoutes(server, { staticRoot: root });
  return server;
}

describe('B617 blog routes', () => {
  it('serves every guide with its own head, one h1 and JSON-LD in the HTML', async () => {
    const server = await app();
    for (const guide of GUIDES) {
      const response = await server.inject(guidePath(guide.slug));
      expect(response.statusCode).toBe(200);
      const html = response.body;
      expect(html).toContain(
        `<link rel="canonical" href="https://openqareer.com${guidePath(guide.slug)}">`,
      );
      expect(html).toContain('<meta name="robots" content="index, follow">');
      expect(html.match(/<h1[ >]/gu)).toHaveLength(1);
      expect(html).toContain('"@type":"FAQPage"');
      expect(html).toContain('"@type":"Article"');
    }
  });

  it('serves the hub and 404s unknown slugs', async () => {
    const server = await app();
    expect((await server.inject('/blog')).statusCode).toBe(200);
    const missing = await server.inject('/blog/no-such-post');
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['x-robots-tag']).toBe('noindex');
  });
});

describe('B617 blog checklist', () => {
  it('keeps every post free of internal codes and links each number to a source', () => {
    for (const post of GUIDES) {
      const text = JSON.stringify(post);
      expect(text, post.slug).not.toMatch(/\b(?:US-\d|B\d{3}|EPIC-)/u);
      const ids = new Set(post.sources.map((source) => source.id));
      for (const section of post.sections) {
        for (const block of section.blocks) {
          if (block.kind !== 'paragraph') continue;
          for (const id of block.sourceIds ?? [])
            expect(ids.has(id), `${post.slug}:${id}`).toBe(true);
          if (/\d+\s?%/u.test(block.text))
            expect(block.sourceIds?.length ?? 0, `${post.slug}: ${block.text}`).toBeGreaterThan(0);
        }
        expect(section.action?.href ?? '/', post.slug).toMatch(/^\//u);
      }
      expect(post.sections[0]?.action, `${post.slug}: первая секция без входа`).toBeUndefined();
    }
  });

  it('links blog and guides hubs to each other', async () => {
    const server = await app();
    const blog = (await server.inject('/blog')).body;
    expect(blog).toContain('href="/guides/cant-find-a-job"');
  });
});
