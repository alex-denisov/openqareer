import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FastifyInstance } from 'fastify';
import {
  AUTHOR,
  AUTHOR_ACCOUNT,
  AUTHOR_PATH,
  AUTHOR_PHOTO_PATH,
  authorPerson,
} from '../../shared/author';
import { SITE_ORIGIN } from '../../shared/siteOrigin';
import { GUIDES, guidePath } from '../../shared/guides';
import { BLOG_POSTS, blogPath } from '../../shared/blog';
import { AuthorPage } from '../../src/features/site/AuthorPage';
import { SALARY_MARKET_TEMPLATE } from '../../src/features/site/SalaryMarketPage';
import { renderGuideDocument } from './guideRoutes';

export interface AuthorPhoto {
  readonly mime: string;
  readonly bytes: Buffer;
}

/** Reads the author's current profile photo; null when the profile has none. */
export type AuthorPhotoReader = () => AuthorPhoto | null;

interface PhotoStore {
  getResumeCandidate(candidateId: string): { readonly photoMediaId?: string } | null;
  getCandidateMedia(candidateId: string, mediaId: string): AuthorPhoto | null;
}

/**
 * One source for the photo: the account's current profile photo
 * (`resume_drafts.photoMediaId` → `candidate_media`), never a copy in git.
 */
export function profilePhotoReader(databasePath: string, store: PhotoStore): AuthorPhotoReader {
  return () => {
    if (databasePath === ':memory:' || !existsSync(databasePath)) return null;
    const database = new DatabaseSync(databasePath, { readOnly: true });
    let candidateId: string | undefined;
    try {
      const row = database
        .prepare('SELECT candidate_id FROM users WHERE username = ?')
        .get(AUTHOR_ACCOUNT) as { candidate_id: string | null } | undefined;
      candidateId = row?.candidate_id ?? undefined;
    } finally {
      database.close();
    }
    if (!candidateId) return null;
    const mediaId = store.getResumeCandidate(candidateId)?.photoMediaId;
    return mediaId ? store.getCandidateMedia(candidateId, mediaId) : null;
  };
}

export const AUTHOR_TITLE = `${AUTHOR.nameRu} — ${AUTHOR.jobTitleRu} · openqareer`;

export function renderAuthor(template: string): string {
  const articles = [
    ...GUIDES.map((guide) => ({ href: guidePath(guide.slug), title: guide.h1 })),
    ...BLOG_POSTS.map((post) => ({ href: blogPath(post.slug), title: post.h1 })),
  ];
  return renderGuideDocument(
    template,
    {
      title: AUTHOR_TITLE,
      description: AUTHOR.lead,
      path: AUTHOR_PATH,
      structured: [
        {
          '@type': 'ProfilePage',
          url: `${SITE_ORIGIN}${AUTHOR_PATH}`,
          inLanguage: 'ru-RU',
          dateModified: AUTHOR.checkedAt,
          mainEntity: authorPerson(),
        },
      ],
    },
    renderToStaticMarkup(React.createElement(AuthorPage, { articles })),
  );
}

const PHOTO_TTL_MS = 5 * 60_000;

export function registerAuthorRoutes(
  app: FastifyInstance,
  options: { readonly staticRoot: string; readonly readPhoto?: AuthorPhotoReader },
): void {
  const templatePath = join(options.staticRoot, SALARY_MARKET_TEMPLATE);
  const template = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : undefined;
  const page = template ? renderAuthor(template) : undefined;
  let cached: { at: number; photo: AuthorPhoto | null } | undefined;

  app.get(AUTHOR_PATH, (_request, reply) => {
    if (!page)
      return reply.code(503).header('X-Robots-Tag', 'noindex').send('Страница временно недоступна');
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(page);
  });

  app.get(AUTHOR_PHOTO_PATH, (request, reply) => {
    const now = Date.now();
    if (!cached || now - cached.at > PHOTO_TTL_MS) {
      try {
        cached = { at: now, photo: options.readPhoto?.() ?? null };
      } catch (error) {
        request.log.error({ err: error }, 'author photo read failed');
        cached = { at: now, photo: null };
      }
    }
    if (!cached.photo) return reply.code(404).header('X-Robots-Tag', 'noindex').send('Нет фото');
    return reply
      .type(cached.photo.mime)
      .header('Cache-Control', 'public, max-age=3600')
      .header('X-Content-Type-Options', 'nosniff')
      .send(cached.photo.bytes);
  });
}
