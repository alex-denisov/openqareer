import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { SALARY_MARKET_TEMPLATE } from '../../src/features/site/SalaryMarketPage';
import type { MarketReport } from '../../shared/marketReport';
import { resetMarketReports, setMarketReports } from '../seo/marketReportSnapshot';
import { monthFromSlug, registerMarketReportRoutes } from './marketReportRoutes';

const REPORT: MarketReport = {
  month: '2026-10',
  generatedAt: '2026-11-01',
  vacancies: 1200,
  sourceRecords: 1900,
  remote: 300,
  withPeriodisedRange: 140,
  salaryGroups: [
    { currency: 'USD', period: 'year', sample: 90, medianLow: 120_000, medianHigh: 160_000 },
  ],
  hiddenSalaryGroups: 2,
  topRoles: [{ slug: 'dev', label: 'Разработчик', count: 200 }],
};

const TEMPLATE =
  '<html><head><title>x</title><meta name="description" content="x"><link rel="canonical" href="x"></head><body>%%SALARY_CONTENT%%</body></html>';

async function app() {
  const root = mkdtempSync(join(tmpdir(), 'oq-reports-'));
  const file = join(root, SALARY_MARKET_TEMPLATE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, TEMPLATE);
  const server = Fastify();
  registerMarketReportRoutes(server, { staticRoot: root });
  await server.ready();
  return server;
}

afterEach(() => resetMarketReports());

describe('market report routes', () => {
  it('parses only rynok-vakansiy-YYYY-MM slugs', () => {
    expect(monthFromSlug('rynok-vakansiy-2026-10')).toBe('2026-10');
    expect(monthFromSlug('rynok-vakansiy-2026-13')).toBeUndefined();
    expect(monthFromSlug('2026-10')).toBeUndefined();
  });

  it('renders the report with sample, source, date and Dataset markup', async () => {
    setMarketReports([REPORT]);
    const server = await app();
    const page = await server.inject('/reports/rynok-vakansiy-2026-10');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('"@type":"Dataset"');
    expect(page.body).toContain('"temporalCoverage":"2026-10-01/2026-10-31"');
    expect(page.body).toContain('/authors/alexey-denisov');
    expect(page.body).toContain('выборка 140');
    expect(page.body).toContain('Как считали');
    expect(page.body).toContain('120 000');
    const hub = await server.inject('/reports');
    expect(hub.statusCode).toBe(200);
    expect(hub.body).toContain('/reports/rynok-vakansiy-2026-10');
  });

  it('answers 404 noindex for an unknown month and an empty hub', async () => {
    const server = await app();
    const missing = await server.inject('/reports/rynok-vakansiy-2026-09');
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['x-robots-tag']).toBe('noindex');
    expect((await server.inject('/reports')).statusCode).toBe(404);
  });
});

describe('report cells on a phone', () => {
  it('every number cell carries its column label', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../../src/features/site/MarketReportPage.tsx', import.meta.url),
      'utf8',
    );
    expect(source.match(/<td>\{num\(/gu) ?? []).toHaveLength(0);
  });
});
