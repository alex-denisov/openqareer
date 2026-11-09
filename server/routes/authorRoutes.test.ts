import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerAuthorRoutes } from './authorRoutes';
import { AUTHOR_PHOTO_PATH, RETIRED_AUTHOR_PATH } from '../../shared/author';
import { guideStructuredData } from '../../shared/guides/structuredData';
import { GUIDES } from '../../shared/guides';
import { buildLlmsFullTxt, buildLlmsTxt } from '../../shared/aeoSurface';

describe('author card (no author page, owner decision 09.11)', () => {
  it('the retired author page answers 301 to the home page', async () => {
    const app = Fastify();
    registerAuthorRoutes(app, {});
    const response = await app.inject(RETIRED_AUTHOR_PATH);
    expect(response.statusCode).toBe(301);
    expect(response.headers.location).toBe('/');
  });

  it('serves the photo from the profile reader, one source for every page', async () => {
    const app = Fastify();
    const bytes = Buffer.from([0xff, 0xd8, 0xff]);
    registerAuthorRoutes(app, { readPhoto: () => ({ mime: 'image/jpeg', bytes }) });
    const response = await app.inject(AUTHOR_PHOTO_PATH);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.rawPayload.equals(bytes)).toBe(true);
  });

  it('answers 404 when the profile has no photo', async () => {
    const app = Fastify();
    registerAuthorRoutes(app, { readPhoto: () => null });
    expect((await app.inject(AUTHOR_PHOTO_PATH)).statusCode).toBe(404);
  });

  it('Article author is a Person with name, jobTitle, image, sameAs and the site url only', () => {
    const article = guideStructuredData(GUIDES[0]!)[0] as { author: Record<string, unknown> };
    expect(Object.keys(article.author).sort()).toEqual(
      ['@type', 'image', 'jobTitle', 'name', 'sameAs', 'url'].sort(),
    );
    expect(article.author).toMatchObject({
      name: 'Алексей Денисов',
      jobTitle: 'CEO openqareer',
      sameAs: ['https://www.linkedin.com/in/alexeydenisov/'],
      url: 'https://openqareer.com/',
    });
  });

  it('no biography reaches llms.txt', () => {
    for (const text of [buildLlmsTxt(), buildLlmsFullTxt()]) {
      expect(text).not.toContain(RETIRED_AUTHOR_PATH);
      expect(text).not.toMatch(/Kaspersky|Fishance|техническ\S* поддержк\S* и операцион/u);
    }
  });
});
