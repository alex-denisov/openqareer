import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FastifyInstance } from 'fastify';
import type {
  SalaryMarketIndexEntry,
  SalaryMarketSnapshot,
} from '../../shared/salaryMarketSnapshot';
import { SITE_ORIGIN } from '../../shared/aeoSurface';
import {
  SalaryMarketPage,
  SalaryMarketDirectory,
  salaryRolePath,
  salarySnapshotIndexable,
  salaryPageTitle,
  SALARY_MARKET_DESCRIPTION,
  SALARY_MARKET_TEMPLATE,
} from '../../src/features/site/SalaryMarketPage';
import {
  readSalaryMarketSnapshot,
  readSalaryMarketIndex,
} from '../salaryMarket/salaryMarketSnapshot';
import { escapeHtml } from '../vacancies/catalogHtml';

/** Role lookup only: no catalog, aggregate or list query belongs on this HTTP path. */
export function loadPublicSalarySnapshot(
  databasePath: string,
  role: string,
): SalaryMarketSnapshot | null {
  if (!salaryRolePath(role) || !existsSync(databasePath)) return null;
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return readSalaryMarketSnapshot(database, role);
  } finally {
    database.close();
  }
}
export function loadPublicSalaryIndex(databasePath: string): readonly SalaryMarketIndexEntry[] {
  if (!existsSync(databasePath)) return [];
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return readSalaryMarketIndex(database);
  } finally {
    database.close();
  }
}
export function renderSalaryMarketDocument(
  template: string,
  snapshot: SalaryMarketSnapshot | null,
  role: string,
  selectedGroup = 0,
  directory?: readonly SalaryMarketIndexEntry[],
): string {
  const path = directory ? '/salaries' : (salaryRolePath(role) ?? '/salaries');
  const canonical = `${SITE_ORIGIN}${path}`;
  const title = escapeHtml(salaryPageTitle(snapshot));
  const robots = (
    directory ? directory.some((entry) => entry.indexable) : salarySnapshotIndexable(snapshot)
  )
    ? 'index, follow'
    : 'noindex, follow';
  const structured = salaryStructuredData(snapshot, canonical);
  const content = renderToStaticMarkup(
    directory
      ? React.createElement(SalaryMarketDirectory, { roles: directory, page: selectedGroup || 1 })
      : React.createElement(SalaryMarketPage, { snapshot, selectedGroup }),
  );
  return salaryDocumentHead(template, { title, canonical, robots, structured }).replace(
    '%%SALARY_CONTENT%%',
    () => content,
  );
}

function salaryStructuredData(snapshot: SalaryMarketSnapshot | null, canonical: string): string {
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'openqareer', item: `${SITE_ORIGIN}/` },
        {
          '@type': 'ListItem',
          position: 2,
          name: snapshot?.roleLabel ?? 'Зарплаты и навыки',
          item: canonical,
        },
      ],
    },
  ];
  if (salarySnapshotIndexable(snapshot) && snapshot)
    graph.push({
      '@type': 'Occupation',
      name: snapshot.roleLabel,
      description: 'Опубликованные зарплатные вилки и навыки в каталожной выборке за 90 дней.',
      mainEntityOfPage: canonical,
    });
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(
    /</gu,
    '\\u003c',
  );
}

function salaryDocumentHead(
  template: string,
  {
    title,
    canonical,
    robots,
    structured,
  }: { title: string; canonical: string; robots: string; structured: string },
): string {
  return template
    .replace(/<title>[^<]*<\/title>/u, () => `<title>${title}</title>`)
    .replace(
      /<meta name="description" content="[^"]*">/u,
      `<meta name="description" content="${escapeHtml(SALARY_MARKET_DESCRIPTION)}">`,
    )
    .replace(/<link rel="canonical" href="[^"]*">/u, `<link rel="canonical" href="${canonical}">`)
    .replace(/<meta name="robots"[^>]*>/gu, '')
    .replace(
      /<meta property="og:url" content="[^"]*">/u,
      `<meta property="og:url" content="${canonical}">`,
    )
    .replace(
      /(<meta (?:property|name)="(?:og|twitter):title" content=")[^"]*/gu,
      (_match, prefix: string) => `${prefix}${title}`,
    )
    .replace(
      /(<meta (?:property|name)="(?:og|twitter):description" content=")[^"]*/gu,
      `$1${escapeHtml(SALARY_MARKET_DESCRIPTION)}`,
    )
    .replace(
      '</head>',
      () =>
        `<meta name="robots" content="${robots}"><script type="application/ld+json">${structured}</script></head>`,
    );
}
interface SalaryRouteOptions {
  staticRoot: string;
  databasePath: string;
  read?: (role: string) => SalaryMarketSnapshot | null;
  readIndex?: () => readonly SalaryMarketIndexEntry[];
}
export function registerSalaryMarketRoutes(
  app: FastifyInstance,
  options: SalaryRouteOptions,
): void {
  const templatePath = join(options.staticRoot, SALARY_MARKET_TEMPLATE);
  // Build artifact, read once; market data is read by primary key per request.
  const template = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : undefined;
  registerSalaryDirectoryRoute(app, options, template);
  const read =
    options.read ?? ((role: string) => loadPublicSalarySnapshot(options.databasePath, role));
  app.get<{ Params: { role: string }; Querystring: { group?: string } }>(
    '/salaries/:role',
    (request, reply) => {
      const role = request.params.role;
      if (!salaryRolePath(role))
        return reply.code(404).header('X-Robots-Tag', 'noindex').send('Профессия не найдена');
      if (!template)
        return reply
          .code(503)
          .header('X-Robots-Tag', 'noindex')
          .send('Страница временно недоступна');
      let snapshot: SalaryMarketSnapshot | null;
      try {
        snapshot = read(role);
      } catch {
        return reply.code(503).header('X-Robots-Tag', 'noindex').send('Данные временно недоступны');
      }
      const group = /^\d{1,3}$/u.test(request.query.group ?? '') ? Number(request.query.group) : 0;
      return reply
        .type('text/html; charset=utf-8')
        .header('Cache-Control', 'no-cache')
        .code(snapshot ? 200 : 404)
        .send(renderSalaryMarketDocument(template, snapshot, role, group));
    },
  );
}

function registerSalaryDirectoryRoute(
  app: FastifyInstance,
  options: SalaryRouteOptions,
  template?: string,
): void {
  app.get<{ Querystring: { page?: string } }>('/salaries', (request, reply) => {
    if (!template)
      return reply.code(503).header('X-Robots-Tag', 'noindex').send('Страница временно недоступна');
    try {
      const roles = options.readIndex
        ? options.readIndex()
        : loadPublicSalaryIndex(options.databasePath);
      const page = /^\d{1,3}$/u.test(request.query.page ?? '') ? Number(request.query.page) : 1;
      return reply
        .type('text/html; charset=utf-8')
        .header('Cache-Control', 'no-cache')
        .send(renderSalaryMarketDocument(template, null, '', page, roles));
    } catch {
      return reply.code(503).header('X-Robots-Tag', 'noindex').send('Данные временно недоступны');
    }
  });
}
