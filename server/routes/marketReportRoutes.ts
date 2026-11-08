import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { SITE_ORIGIN } from '../../shared/aeoSurface';
import { authorReference } from '../../shared/author';
import { legalPath } from '../../shared/legalRegistry';
import {
  MARKET_REPORTS_ROOT,
  MARKET_REPORT_PREFIX,
  isReportMonth,
  marketReportPath,
  marketReportTitle,
  monthRange,
  type MarketReport,
} from '../../shared/marketReport';
import { MarketReportPage, MarketReportsHub } from '../../src/features/site/MarketReportPage';
import { SALARY_MARKET_TEMPLATE } from '../../src/features/site/SalaryMarketPage';
import { getMarketReports } from '../seo/marketReportSnapshot';
import { renderGuideDocument } from './guideRoutes';

/** GEO 09.11: `/reports` and `/reports/rynok-vakansiy-<yyyy-mm>` from the in-memory snapshot. */

const ORGANIZATION = { '@type': 'Organization', name: 'openqareer', url: `${SITE_ORIGIN}/` };

export const MARKET_REPORTS_HUB_TITLE = 'Отчёты о рынке вакансий по месяцам · openqareer';
export const MARKET_REPORTS_HUB_DESCRIPTION =
  'Ежемесячные отчёты openqareer: число вакансий каталога, медианы зарплатных вилок с периодом оплаты, доля удалённых и топ ролей.';

function description(report: MarketReport): string {
  return `Вакансии каталога openqareer за ${report.month}: ${report.vacancies} вакансий, медианы вилок с периодом оплаты, доля удалённых, топ ролей. Метод и выборка на странице.`;
}

function breadcrumbs(report?: MarketReport): Record<string, unknown> {
  const items = [
    { name: 'Главная', item: `${SITE_ORIGIN}/` },
    { name: 'Отчёты о рынке', item: `${SITE_ORIGIN}${MARKET_REPORTS_ROOT}` },
    ...(report
      ? [{ name: report.month, item: `${SITE_ORIGIN}${marketReportPath(report.month)}` }]
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

export function marketReportStructuredData(report: MarketReport): Record<string, unknown>[] {
  const url = `${SITE_ORIGIN}${marketReportPath(report.month)}`;
  const range = monthRange(report.month);
  return [
    {
      '@type': 'Dataset',
      name: marketReportTitle(report.month),
      description: description(report),
      url,
      inLanguage: 'ru-RU',
      temporalCoverage: `${range.start}/${range.end}`,
      dateModified: report.generatedAt,
      creator: authorReference(),
      publisher: ORGANIZATION,
      isAccessibleForFree: true,
      license: `${SITE_ORIGIN}${legalPath('terms')}`,
      variableMeasured: [
        'Число вакансий',
        'Медиана нижней и верхней границы зарплатной вилки',
        'Доля удалённых вакансий',
        'Роли с наибольшим числом вакансий',
      ],
      measurementTechnique:
        'Карточки каталога после сведения повторов; в медиану входят вилки с явным периодом оплаты; цифры из выборки меньше 5 не публикуются.',
    },
    breadcrumbs(report),
  ];
}

export function renderMarketReport(template: string, report: MarketReport): string {
  return renderGuideDocument(
    template,
    {
      title: `${marketReportTitle(report.month)} · openqareer`,
      description: description(report),
      path: marketReportPath(report.month),
      structured: marketReportStructuredData(report),
    },
    renderToStaticMarkup(React.createElement(MarketReportPage, { report })),
  );
}

export function renderMarketReportsHub(template: string, reports: readonly MarketReport[]): string {
  return renderGuideDocument(
    template,
    {
      title: MARKET_REPORTS_HUB_TITLE,
      description: MARKET_REPORTS_HUB_DESCRIPTION,
      path: MARKET_REPORTS_ROOT,
      structured: [breadcrumbs()],
    },
    renderToStaticMarkup(React.createElement(MarketReportsHub, { reports })),
  );
}

/** `rynok-vakansiy-2026-10` → `2026-10`; anything else → undefined. */
export function monthFromSlug(slug: string): string | undefined {
  if (!slug.startsWith(MARKET_REPORT_PREFIX)) return undefined;
  const month = slug.slice(MARKET_REPORT_PREFIX.length);
  return isReportMonth(month) ? month : undefined;
}

function sendHtml(reply: FastifyReply, html: string): FastifyReply {
  return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(html);
}

export function registerMarketReportRoutes(
  app: FastifyInstance,
  options: { readonly staticRoot: string },
): void {
  const templatePath = join(options.staticRoot, SALARY_MARKET_TEMPLATE);
  const template = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : undefined;
  // One render per stored version of a report.
  const rendered = new Map<string, string>();
  app.get(MARKET_REPORTS_ROOT, (_request, reply) => {
    const reports = getMarketReports();
    if (reports.length === 0)
      return reply.code(404).header('X-Robots-Tag', 'noindex').send('Отчётов пока нет');
    if (!template)
      return reply.code(503).header('X-Robots-Tag', 'noindex').send('Страница временно недоступна');
    return sendHtml(reply, renderMarketReportsHub(template, reports));
  });
  app.get<{ Params: { slug: string } }>(`${MARKET_REPORTS_ROOT}/:slug`, (request, reply) => {
    const month = monthFromSlug(request.params.slug);
    const report = month ? getMarketReports().find((row) => row.month === month) : undefined;
    if (!report) return reply.code(404).header('X-Robots-Tag', 'noindex').send('Отчёт не найден');
    if (!template)
      return reply.code(503).header('X-Robots-Tag', 'noindex').send('Страница временно недоступна');
    const key = `${report.month}|${report.generatedAt}`;
    const html = rendered.get(key) ?? renderMarketReport(template, report);
    rendered.set(key, html);
    return sendHtml(reply, html);
  });
}
