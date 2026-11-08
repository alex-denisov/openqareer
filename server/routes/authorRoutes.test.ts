import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerAuthorRoutes } from './authorRoutes';
import { AUTHOR_PATH, AUTHOR_PHOTO_PATH, AUTHOR_URL } from '../../shared/author';
import { guideStructuredData } from '../../shared/guides/structuredData';
import { GUIDES } from '../../shared/guides';
import { SALARY_MARKET_TEMPLATE } from '../../src/features/site/SalaryMarketPage';

const TEMPLATE =
  '<html><head><title>x</title><meta name="description" content="x"><link rel="canonical" href="x"></head><body>%%SALARY_CONTENT%%</body></html>';

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'author-'));
  writeFileSync(join(dir, SALARY_MARKET_TEMPLATE), TEMPLATE);
  return dir;
}

describe('author page', () => {
  it('renders Person markup with RU/EN name, CEO, worksFor and LinkedIn', async () => {
    const app = Fastify();
    registerAuthorRoutes(app, { staticRoot: root() });
    const response = await app.inject(AUTHOR_PATH);
    expect(response.statusCode).toBe(200);
    const json = JSON.parse(
      /<script type="application\/ld\+json">(.+?)<\/script>/u.exec(response.body)![1]!,
    );
    const person = json['@graph'][0].mainEntity;
    expect(person).toMatchObject({
      '@type': 'Person',
      name: 'Алексей Денисов',
      alternateName: 'Alexey Denisov',
      jobTitle: 'CEO',
      worksFor: { '@type': 'Organization', name: 'openqareer' },
      sameAs: ['https://www.linkedin.com/in/alexeydenisov/'],
    });
    expect(response.body).toContain(`src="${AUTHOR_PHOTO_PATH}"`);
  });

  it('serves the photo from the profile reader, one source for every page', async () => {
    const app = Fastify();
    const bytes = Buffer.from([0xff, 0xd8, 0xff]);
    registerAuthorRoutes(app, {
      staticRoot: root(),
      readPhoto: () => ({ mime: 'image/jpeg', bytes }),
    });
    const response = await app.inject(AUTHOR_PHOTO_PATH);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.rawPayload.equals(bytes)).toBe(true);
  });

  it('answers 404 when the profile has no photo', async () => {
    const app = Fastify();
    registerAuthorRoutes(app, { staticRoot: root(), readPhoto: () => null });
    expect((await app.inject(AUTHOR_PHOTO_PATH)).statusCode).toBe(404);
  });

  it('Article author points to the author page', () => {
    const article = guideStructuredData(GUIDES[0]!)[0] as { author: Record<string, unknown> };
    expect(article.author).toMatchObject({ '@type': 'Person', url: AUTHOR_URL });
  });
});
