import Fastify from 'fastify';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDES, guidePath } from '../../shared/guides';
import { SALARY_MARKET_TEMPLATE } from '../../src/features/site/SalaryMarketPage';
import { registerGuideRoutes } from './guideRoutes';

const TEMPLATE =
  '<html><head><title>x</title><meta name="description" content="x"><link rel="canonical" href="x">' +
  '<meta property="og:url" content="x"><meta property="og:title" content="x"><meta property="og:image" content="x">' +
  '</head><body>%%SALARY_CONTENT%%</body></html>';

async function app() {
  const root = mkdtempSync(join(tmpdir(), 'guides-'));
  writeFileSync(join(root, SALARY_MARKET_TEMPLATE), TEMPLATE);
  const server = Fastify();
  registerGuideRoutes(server, { staticRoot: root });
  return server;
}

describe('B616 guide routes', () => {
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
    expect((await server.inject('/guides')).statusCode).toBe(200);
    const missing = await server.inject('/guides/no-such-guide');
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['x-robots-tag']).toBe('noindex');
  });
});
