import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FastifyInstance } from 'fastify';
import { BLOG_POSTS, BLOG_ROOT, blogPath, findBlogPost } from '../../shared/blog';
import { GUIDES } from '../../shared/guides';
import type { Guide } from '../../shared/guides/types';
import { BLOG_COLLECTION, GUIDES_COLLECTION } from '../../shared/guides/collection';
import { guideStructuredData, guidesHubStructuredData } from '../../shared/guides/structuredData';
import { GuidePage, GuidesHubPage } from '../../src/features/site/GuidePage';
import { SALARY_MARKET_TEMPLATE } from '../../src/features/site/SalaryMarketPage';
import { renderGuideDocument } from './guideRoutes';

/** B617: блог рендерит сервер из шаблона /guides — те же head, JSON-LD и стили. */
export const BLOG_HUB_TITLE = 'Блог openqareer: резюме, собеседования, поиск работы';
export const BLOG_HUB_DESCRIPTION =
  'Разборы для кандидатов от карьерного консультанта: резюме, собеседование, оффер, испытательный срок, увольнение и где искать работу.';
const BLOG_HUB_LEAD =
  'Разборы частых вопросов кандидатов: что ответить, что проверить и как openqareer помогает с этим шагом.';

export function renderBlogPost(template: string, post: Guide): string {
  return renderGuideDocument(
    template,
    {
      title: post.title,
      description: post.description,
      path: blogPath(post.slug),
      structured: guideStructuredData(post, BLOG_COLLECTION),
    },
    renderToStaticMarkup(
      React.createElement(GuidePage, { guide: post, collection: BLOG_COLLECTION }),
    ),
  );
}

export function renderBlogHub(template: string): string {
  return renderGuideDocument(
    template,
    {
      title: BLOG_HUB_TITLE,
      description: BLOG_HUB_DESCRIPTION,
      path: BLOG_ROOT,
      structured: guidesHubStructuredData(BLOG_POSTS, BLOG_COLLECTION),
    },
    renderToStaticMarkup(
      React.createElement(GuidesHubPage, {
        guides: BLOG_POSTS,
        title: BLOG_COLLECTION.hubName,
        collection: BLOG_COLLECTION,
        lead: BLOG_HUB_LEAD,
        cross: { title: 'Опорные материалы', items: GUIDES, collection: GUIDES_COLLECTION },
      }),
    ),
  );
}

export function registerBlogRoutes(
  app: FastifyInstance,
  options: { readonly staticRoot: string },
): void {
  const templatePath = join(options.staticRoot, SALARY_MARKET_TEMPLATE);
  const template = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : undefined;
  const unavailable = 'Страница временно недоступна';
  const hub = template ? renderBlogHub(template) : undefined;
  const pages = new Map(
    template ? BLOG_POSTS.map((post) => [post.slug, renderBlogPost(template, post)] as const) : [],
  );
  app.get(BLOG_ROOT, (_request, reply) => {
    if (!hub) return reply.code(503).header('X-Robots-Tag', 'noindex').send(unavailable);
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(hub);
  });
  app.get<{ Params: { slug: string } }>(`${BLOG_ROOT}/:slug`, (request, reply) => {
    if (!findBlogPost(request.params.slug))
      return reply.code(404).header('X-Robots-Tag', 'noindex').send('Статья не найдена');
    const page = pages.get(request.params.slug);
    if (!page) return reply.code(503).header('X-Robots-Tag', 'noindex').send(unavailable);
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(page);
  });
}
