import {
  isSalaryMarketGrade,
  selectSalaryGrade,
  salaryRoleLabel,
  type SalaryMarketSkillSummary,
} from '../../shared/salaryMarketPublic';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  SalaryMarketGrade,
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
import { MIN_SALARY_MARKET_SAMPLE } from '../../shared/salaryMarketSnapshot';
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
  grade?: SalaryMarketGrade,
  skillsPage = 1,
): string {
  const path = directory ? '/salaries' : (salaryRolePath(role) ?? '/salaries');
  const canonical = `${SITE_ORIGIN}${path}`;
  const visible = selectSalaryGrade(snapshot, grade);
  const title = escapeHtml(salaryPageTitle(visible ?? snapshot));
  const robots = (
    directory ? directory.some((entry) => entry.indexable) : salarySnapshotIndexable(visible)
  )
    ? 'index, follow'
    : 'noindex, follow';
  const structured = salaryStructuredData(visible, canonical);
  const content = renderToStaticMarkup(
    directory
      ? React.createElement(SalaryMarketDirectory, { roles: directory, page: selectedGroup || 1 })
      : React.createElement(SalaryMarketPage, { snapshot, selectedGroup, grade, skillsPage }),
  );
  return salaryDocumentHead(template, { title, canonical, robots, structured })
    .replace('%%SALARY_CONTENT%%', () => content)
    .replace('</body>', '<script type="module" src="/assets/oq-salary-gap-1.js"></script></body>');
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
          name: snapshot ? salaryRoleLabel(snapshot) : 'Зарплаты и навыки',
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
  registerSalarySkillSummary(app, read);
  app.get<{
    Params: { role: string };
    Querystring: { group?: string; grade?: string; skills?: string };
  }>('/salaries/:role', (request, reply) => {
    const role = request.params.role;
    if (!salaryRolePath(role))
      return reply.code(404).header('X-Robots-Tag', 'noindex').send('Профессия не найдена');
    if (!template)
      return reply.code(503).header('X-Robots-Tag', 'noindex').send('Страница временно недоступна');
    let snapshot: SalaryMarketSnapshot | null;
    try {
      snapshot = read(role);
    } catch {
      return reply.code(503).header('X-Robots-Tag', 'noindex').send('Данные временно недоступны');
    }
    return sendSalaryView(reply, template, snapshot, role, request.query);
  });
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

function sendSalaryView(
  reply: FastifyReply,
  template: string,
  snapshot: SalaryMarketSnapshot | null,
  role: string,
  query: { grade?: string; group?: string; skills?: string },
) {
  const rawGrade = query.grade;
  const grade = rawGrade && isSalaryMarketGrade(rawGrade) ? rawGrade : undefined;
  if (rawGrade && !grade)
    return reply.code(400).header('X-Robots-Tag', 'noindex').send('Неизвестный грейд');
  if (grade && !selectSalaryGrade(snapshot, grade))
    return reply
      .code(404)
      .header('X-Robots-Tag', 'noindex')
      .send('Срез для этого грейда не подготовлен');
  const group = /^\d{1,3}$/u.test(query.group ?? '') ? Number(query.group) : 0;
  const skillsPage = /^\d{1,3}$/u.test(query.skills ?? '') ? Number(query.skills) : 1;
  return reply
    .type('text/html; charset=utf-8')
    .header('Cache-Control', 'no-cache')
    .code(snapshot ? 200 : 404)
    .send(
      renderSalaryMarketDocument(template, snapshot, role, group, undefined, grade, skillsPage),
    );
}

/** Public aggregate projection only. No candidate input, source scan or account data. */
function registerSalarySkillSummary(
  app: FastifyInstance,
  read: (role: string) => SalaryMarketSnapshot | null,
): void {
  app.get<{ Params: { role: string }; Querystring: { grade?: string } }>(
    '/api/v1/public/salary-markets/:role/skills',
    (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { role } = request.params;
      if (!salaryRolePath(role)) return reply.code(404).send({ error: { code: 'not_found' } });
      const raw = request.query.grade;
      const grade = raw && isSalaryMarketGrade(raw) ? raw : null;
      if (raw && !grade) return reply.code(400).send({ error: { code: 'invalid_grade' } });
      try {
        const visible = selectSalaryGrade(read(role), grade ?? undefined);
        if (!visible) return reply.code(404).send({ error: { code: 'not_found' } });
        const data = visible.role === role ? publicSkillSummary(visible, grade) : null;
        if (!data) return reply.code(503).send({ error: { code: 'aggregate_unavailable' } });
        return { data };
      } catch {
        return reply.code(503).send({ error: { code: 'temporarily_unavailable' } });
      }
    },
  );
}
function publicSkillSummary(
  visible: SalaryMarketSnapshot,
  grade: SalaryMarketGrade | null,
): SalaryMarketSkillSummary | null {
  if (
    !Number.isSafeInteger(visible.sampleSize) ||
    visible.sampleSize < MIN_SALARY_MARKET_SAMPLE ||
    !Number.isFinite(Date.parse(visible.updatedAt)) ||
    visible.source !== 'deduplicated_public_catalog' ||
    !visible.skills.length
  )
    return null;
  const rows = visible.skills.slice(0, 15);
  if (
    rows.some(
      (row) =>
        typeof row.name !== 'string' ||
        row.name.length > 128 ||
        !row.name.trim().length ||
        !Number.isSafeInteger(row.count) ||
        row.count < 0 ||
        row.count > visible.sampleSize,
    )
  )
    return null;
  return {
    role: visible.role,
    grade,
    updatedAt: visible.updatedAt,
    sampleSize: visible.sampleSize,
    source: visible.source,
    skills: rows.map(({ name, count }) => ({
      name,
      count,
      frequency: Math.round((count / visible.sampleSize) * 10000) / 100,
    })),
  };
}
