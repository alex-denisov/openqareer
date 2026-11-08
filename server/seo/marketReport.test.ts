import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { VACANCY_CATALOG_ENTRIES_TABLE, VACANCY_CLUSTERS_TABLE } from '../data/sqliteSchema';
import {
  computeMarketReport,
  ensureMarketReport,
  marketReportPages,
  previousMonth,
  readMarketReports,
} from './marketReport';
import { getMarketReportPages, resetMarketReports, setMarketReports } from './marketReportSnapshot';
import { buildSitemapFiles } from './sitemapXml';
import { buildLlmsTxt } from '../../shared/aeoSurface';

const OCT = Date.UTC(2026, 9, 10);

function yearly(from: number, to: number, currency = 'USD') {
  return {
    from,
    to,
    currency,
    period: 'year',
    periodEvidence: { field: 'lever.salaryRange.interval', value: 'per-year-salary' },
  };
}

function seed(
  database: DatabaseSync,
  rows: ReadonlyArray<{ remote?: boolean; role?: string; salary?: unknown; ms?: number }>,
): void {
  const entry = database.prepare(
    `INSERT INTO catalog_entries (cluster_id, entry_key, path, title, company, is_remote, summary,
      skills_json, source_url, published_at, last_seen_at, source_count, status, role_slug, role_label,
      published_ms, last_seen_ms) VALUES (?, ?, ?, 't', 'c', ?, '', '[]', 'u', '', '', 2, 'active', ?, ?, ?, ?)`,
  );
  const cluster = database.prepare(
    `INSERT INTO vacancy_clusters VALUES (?, 'f', 't', 'c', ?, 1, 0)`,
  );
  rows.forEach((row, index) => {
    const id = `c${String(index).padStart(4, '0')}`;
    entry.run(
      id,
      id,
      `/v/${id}`,
      row.remote ? 1 : 0,
      row.role ?? null,
      row.role ? `Role ${row.role}` : null,
      row.ms ?? OCT,
      row.ms ?? OCT,
    );
    cluster.run(id, JSON.stringify(row.salary === undefined ? {} : { salary: row.salary }));
  });
}

function db(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(VACANCY_CATALOG_ENTRIES_TABLE);
  database.exec(VACANCY_CLUSTERS_TABLE);
  return database;
}

afterEach(() => resetMarketReports());

describe('computeMarketReport', () => {
  it('counts the month, prints a median only for periodised groups of 5+', () => {
    const database = db();
    seed(database, [
      ...Array.from({ length: 5 }, (_v, i) => ({
        role: 'dev',
        remote: i < 2,
        salary: yearly(100_000 + i * 10_000, 150_000 + i * 10_000),
      })),
      // 4 EUR ranges: below the floor, hidden.
      ...Array.from({ length: 4 }, () => ({ role: 'qa', salary: yearly(50_000, 60_000, 'EUR') })),
      // no period evidence: never in a median.
      { role: 'qa', salary: { from: 1, to: 2, currency: 'USD', period: 'year' } },
      // another month: out.
      { role: 'dev', ms: Date.UTC(2026, 10, 2), salary: yearly(1, 2) },
    ]);
    const report = computeMarketReport(database, '2026-10', new Date('2026-11-01T03:00:00Z'));
    expect(report.vacancies).toBe(10);
    expect(report.sourceRecords).toBe(20);
    expect(report.remote).toBe(2);
    expect(report.withPeriodisedRange).toBe(9);
    expect(report.salaryGroups).toEqual([
      { currency: 'USD', period: 'year', sample: 5, medianLow: 120_000, medianHigh: 170_000 },
    ]);
    expect(report.hiddenSalaryGroups).toBe(1);
    expect(report.topRoles).toEqual([
      { slug: 'dev', label: 'Role dev', count: 5 },
      { slug: 'qa', label: 'Role qa', count: 5 },
    ]);
  });

  it('builds the previous month once and exposes it to sitemap and llms.txt', () => {
    const database = db();
    seed(
      database,
      Array.from({ length: 6 }, () => ({ role: 'dev' })),
    );
    const now = new Date('2026-11-01T03:00:00Z');
    expect(previousMonth(now)).toBe('2026-10');
    expect(ensureMarketReport(database, now)).toBe(true);
    expect(ensureMarketReport(database, now)).toBe(false);
    const pages = marketReportPages(database);
    expect(pages.map((page) => page.path)).toEqual(['/reports', '/reports/rynok-vakansiy-2026-10']);
    expect(pages.every((page) => page.description.length > 0)).toBe(true);

    const [staticFile] = buildSitemapFiles({ listings: [], jobs: [], extraPages: pages });
    expect(staticFile!.xml).toContain('https://openqareer.com/reports/rynok-vakansiy-2026-10');

    setMarketReports(readMarketReports(database));
    const llms = buildLlmsTxt(undefined, getMarketReportPages());
    expect(llms).toContain('(https://openqareer.com/reports/rynok-vakansiy-2026-10)');
  });

  it('gives no page to a month below the sample floor', () => {
    const database = db();
    seed(
      database,
      Array.from({ length: 4 }, () => ({ role: 'dev' })),
    );
    ensureMarketReport(database, new Date('2026-11-01T03:00:00Z'));
    expect(marketReportPages(database)).toEqual([]);
  });
});
