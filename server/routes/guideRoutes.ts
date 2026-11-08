import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FastifyInstance } from 'fastify';
import { SITE_ORIGIN } from '../../shared/aeoSurface';
import { GUIDES, GUIDES_ROOT, findGuide, guidePath, type Guide } from '../../shared/guides';
import {
  GUIDES_HUB_NAME,
  guideStructuredData,
  guidesHubStructuredData,
} from '../../shared/guides/structuredData';
import { BLOG_POSTS } from '../../shared/blog';
import { BLOG_COLLECTION } from '../../shared/guides/collection';
import { withOgImage } from '../../shared/seoHead';
import { GuidePage, GuidesHubPage } from '../../src/features/site/GuidePage';
import { SALARY_MARKET_TEMPLATE } from '../../src/features/site/SalaryMarketPage';
import { escapeHtml } from '../vacancies/catalogHtml';

/** B616: опорные материалы рендерит сервер из того же шаблона, что /salaries. */
export const GUIDES_HUB_TITLE =
  'Материалы для кандидата: резюме, письмо, поиск работы · openqareer';
export const GUIDES_HUB_DESCRIPTION =
  'Разборы для кандидатов: почему не получается найти работу, как составить резюме и проверить его на ATS, как написать сопроводительное письмо — с примерами.';

interface GuideDocumentMeta {
  readonly title: string;
  readonly description: string;
  readonly path: string;
  readonly structured: readonly Record<string, unknown>[];
}

export function renderGuideDocument(
  template: string,
  meta: GuideDocumentMeta,
  content: string,
): string {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const canonical = `${SITE_ORIGIN}${meta.path}`;
  const structured = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': meta.structured,
  }).replace(/</gu, '\\u003c');
  return withOgImage(template, 'home', meta.title)
    .replace(/<title>[^<]*<\/title>/u, () => `<title>${title}</title>`)
    .replace(
      /<meta name="description" content="[^"]*">/u,
      () => `<meta name="description" content="${description}">`,
    )
    .replace(
      /<link rel="canonical" href="[^"]*">/u,
      () => `<link rel="canonical" href="${canonical}">`,
    )
    .replace(/<meta name="robots"[^>]*>/gu, '')
    .replace(
      /<meta property="og:url" content="[^"]*">/u,
      () => `<meta property="og:url" content="${canonical}">`,
    )
    .replace(
      /(<meta (?:property|name)="(?:og|twitter):title" content=")[^"]*/gu,
      (_m, prefix: string) => `${prefix}${title}`,
    )
    .replace(
      /(<meta (?:property|name)="(?:og|twitter):description" content=")[^"]*/gu,
      (_m, prefix: string) => `${prefix}${description}`,
    )
    .replace(
      '</head>',
      () =>
        `<meta name="robots" content="index, follow"><script type="application/ld+json">${structured}</script></head>`,
    )
    .replace('%%SALARY_CONTENT%%', () => content);
}

export function renderGuide(template: string, guide: Guide): string {
  return renderGuideDocument(
    template,
    {
      title: guide.title,
      description: guide.description,
      path: guidePath(guide.slug),
      structured: guideStructuredData(guide),
    },
    renderToStaticMarkup(React.createElement(GuidePage, { guide })),
  );
}

export function renderGuidesHub(template: string): string {
  return renderGuideDocument(
    template,
    {
      title: GUIDES_HUB_TITLE,
      description: GUIDES_HUB_DESCRIPTION,
      path: GUIDES_ROOT,
      structured: guidesHubStructuredData(GUIDES),
    },
    renderToStaticMarkup(
      React.createElement(GuidesHubPage, {
        guides: GUIDES,
        title: GUIDES_HUB_NAME,
        cross: { title: 'Статьи блога', items: BLOG_POSTS, collection: BLOG_COLLECTION },
      }),
    ),
  );
}

export function registerGuideRoutes(
  app: FastifyInstance,
  options: { readonly staticRoot: string },
): void {
  const templatePath = join(options.staticRoot, SALARY_MARKET_TEMPLATE);
  const template = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : undefined;
  const unavailable = 'Страница временно недоступна';
  // Документы неизменны в пределах выпуска: собираем один раз.
  const hub = template ? renderGuidesHub(template) : undefined;
  const pages = new Map(
    template ? GUIDES.map((guide) => [guide.slug, renderGuide(template, guide)] as const) : [],
  );
  app.get(GUIDES_ROOT, (_request, reply) => {
    if (!hub) return reply.code(503).header('X-Robots-Tag', 'noindex').send(unavailable);
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(hub);
  });
  app.get<{ Params: { slug: string } }>(`${GUIDES_ROOT}/:slug`, (request, reply) => {
    if (!findGuide(request.params.slug))
      return reply.code(404).header('X-Robots-Tag', 'noindex').send('Материал не найден');
    const page = pages.get(request.params.slug);
    if (!page) return reply.code(503).header('X-Robots-Tag', 'noindex').send(unavailable);
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(page);
  });
}
