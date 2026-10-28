import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SITE_ORIGIN } from '../../shared/aeoSurface';
import {
  interviewEvidence,
  INTERVIEW_HUB_PATH,
  interviewProfession,
  interviewProfessionIndexable,
  interviewProfessionPath,
  interviewProfessionPublished,
  openInterviewQuestions,
  publishedInterviewProfessions,
  type InterviewProfession,
} from '../../shared/interviewQuestions';
import type { SalaryMarketIndexEntry } from '../../shared/salaryMarketSnapshot';
import {
  INTERVIEW_HUB_DESCRIPTION,
  INTERVIEW_HUB_FAQ,
  INTERVIEW_HUB_TITLE,
  InterviewHubPage,
  InterviewProfessionPage,
  interviewProfessionDescription,
  interviewProfessionTitle,
  type InterviewHubEntry,
} from '../../src/features/site/InterviewQuestionsPage';
import { SALARY_MARKET_TEMPLATE } from '../../src/features/site/SalaryMarketPage';
import { escapeHtml } from '../vacancies/catalogHtml';
import { withOgImage } from '../../shared/seoHead';
import { loadPublicSalaryIndex } from './salaryMarketRoutes';

export const INTERVIEW_QUIZ_SCRIPT = '/assets/oq-interview-2.js';

interface InterviewRouteOptions {
  readonly staticRoot: string;
  readonly databasePath: string;
  readonly readIndex?: () => readonly SalaryMarketIndexEntry[];
  /** True when the request carries a live session; locked answers render only then. */
  readonly signedIn?: (request: FastifyRequest) => boolean;
}

interface DocumentMeta {
  readonly title: string;
  readonly description: string;
  readonly canonical: string;
  readonly indexable: boolean;
  readonly structured: Record<string, unknown>[];
}

/** Live catalog counts by role slug; the page stays up when the prepared index is missing. */
function hubEntries(readIndex: () => readonly SalaryMarketIndexEntry[]): InterviewHubEntry[] {
  let counts = new Map<string, number>();
  try {
    counts = new Map(readIndex().map((row) => [row.role, row.sampleSize]));
  } catch {
    /* Counts are optional; the bank itself does not depend on the index. */
  }
  return publishedInterviewProfessions()
    .map((profession) => ({
      profession,
      vacancies: counts.get(profession.slug) ?? interviewEvidence(profession.slug)?.vacancies ?? 0,
    }))
    .sort((a, b) => b.vacancies - a.vacancies);
}

function breadcrumbs(profession?: InterviewProfession): Record<string, unknown> {
  const items = [
    { name: 'Главная', item: `${SITE_ORIGIN}/` },
    { name: 'Вопросы на собеседовании', item: `${SITE_ORIGIN}${INTERVIEW_HUB_PATH}` },
    ...(profession
      ? [
          {
            name: profession.label,
            item: `${SITE_ORIGIN}${interviewProfessionPath(profession.slug)}`,
          },
        ]
      : []),
  ];
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((row, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      ...row,
    })),
  };
}

function faqPage(rows: readonly { question: string; answer: string }[]): Record<string, unknown> {
  return {
    '@type': 'FAQPage',
    mainEntity: rows.map((row) => ({
      '@type': 'Question',
      name: row.question,
      acceptedAnswer: { '@type': 'Answer', text: row.answer },
    })),
  };
}

/** FAQPage only from questions printed in full on the page; locked ones never enter it. */
export function professionStructuredData(
  profession: InterviewProfession,
): Record<string, unknown>[] {
  return [
    breadcrumbs(profession),
    faqPage(
      openInterviewQuestions(profession).map((row) => ({
        question: row.question,
        answer: row.strong,
      })),
    ),
  ];
}

function hubStructuredData(entries: readonly InterviewHubEntry[]): Record<string, unknown>[] {
  return [
    breadcrumbs(),
    {
      '@type': 'CollectionPage',
      name: 'Вопросы на собеседовании по профессиям',
      inLanguage: 'ru-RU',
      url: `${SITE_ORIGIN}${INTERVIEW_HUB_PATH}`,
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: entries.length,
        itemListElement: entries.map((row, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: `${SITE_ORIGIN}${interviewProfessionPath(row.profession.slug)}`,
        })),
      },
    },
    faqPage(INTERVIEW_HUB_FAQ),
  ];
}

export function renderInterviewDocument(
  template: string,
  meta: DocumentMeta,
  content: string,
): string {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const structured = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': meta.structured,
  }).replace(/</gu, '\\u003c');
  return withOgImage(
    template,
    'interview-questions',
    'openqareer: вопросы на собеседовании с разбором ответов',
  )
    .replace(/<title>[^<]*<\/title>/u, () => `<title>${title}</title>`)
    .replace(
      /<meta name="description" content="[^"]*">/u,
      () => `<meta name="description" content="${description}">`,
    )
    .replace(
      /<link rel="canonical" href="[^"]*">/u,
      () => `<link rel="canonical" href="${meta.canonical}">`,
    )
    .replace(/<meta name="robots"[^>]*>/gu, '')
    .replace(
      /<meta property="og:url" content="[^"]*">/u,
      () => `<meta property="og:url" content="${meta.canonical}">`,
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
        `<meta name="robots" content="${meta.indexable ? 'index, follow' : 'noindex, follow'}"><script type="application/ld+json">${structured}</script></head>`,
    )
    .replace('%%SALARY_CONTENT%%', () => content)
    .replace(
      '</body>',
      () => `<script type="module" src="${INTERVIEW_QUIZ_SCRIPT}"></script></body>`,
    );
}

export function renderInterviewHub(
  template: string,
  entries: readonly InterviewHubEntry[],
): string {
  return renderInterviewDocument(
    template,
    {
      title: INTERVIEW_HUB_TITLE,
      description: INTERVIEW_HUB_DESCRIPTION,
      canonical: `${SITE_ORIGIN}${INTERVIEW_HUB_PATH}`,
      indexable: entries.some((row) => interviewProfessionIndexable(row.profession)),
      structured: hubStructuredData(entries),
    },
    renderToStaticMarkup(React.createElement(InterviewHubPage, { entries })),
  );
}

export function renderInterviewProfession(
  template: string,
  profession: InterviewProfession,
  entries: readonly InterviewHubEntry[],
  unlocked = false,
): string {
  const own = entries.find((row) => row.profession.slug === profession.slug);
  const related = entries.filter((row) => row.profession.slug !== profession.slug).slice(0, 7);
  return renderInterviewDocument(
    template,
    {
      title: interviewProfessionTitle(profession),
      description: interviewProfessionDescription(profession),
      canonical: `${SITE_ORIGIN}${interviewProfessionPath(profession.slug)}`,
      indexable: interviewProfessionIndexable(profession),
      structured: professionStructuredData(profession),
    },
    renderToStaticMarkup(
      React.createElement(InterviewProfessionPage, {
        profession,
        vacancies: own?.vacancies ?? 0,
        related,
        unlocked,
      }),
    ),
  );
}

export function registerInterviewQuestionRoutes(
  app: FastifyInstance,
  options: InterviewRouteOptions,
): void {
  const templatePath = join(options.staticRoot, SALARY_MARKET_TEMPLATE);
  // Build artifact with the public header and footer, read once per release.
  const template = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : undefined;
  const readIndex = options.readIndex ?? (() => loadPublicSalaryIndex(options.databasePath));
  const unavailable = 'Страница временно недоступна';
  app.get(INTERVIEW_HUB_PATH, (_request, reply) => {
    if (!template) return reply.code(503).header('X-Robots-Tag', 'noindex').send(unavailable);
    return reply
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(renderInterviewHub(template, hubEntries(readIndex)));
  });
  app.get<{ Params: { profession: string } }>(
    `${INTERVIEW_HUB_PATH}/:profession`,
    (request, reply) => {
      const profession = interviewProfession(request.params.profession);
      if (!profession || !interviewProfessionPublished(profession))
        return reply.code(404).header('X-Robots-Tag', 'noindex').send('Профессия не найдена');
      if (!template) return reply.code(503).header('X-Robots-Tag', 'noindex').send(unavailable);
      const unlocked = options.signedIn?.(request) ?? false;
      return reply
        .type('text/html; charset=utf-8')
        .header('Cache-Control', unlocked ? 'private, no-cache' : 'no-cache')
        .send(renderInterviewProfession(template, profession, hubEntries(readIndex), unlocked));
    },
  );
}
