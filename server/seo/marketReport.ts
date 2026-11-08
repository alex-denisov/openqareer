/**
 * Monthly vacancy market report (GEO 09.11): `/reports/rynok-vakansiy-<yyyy-mm>`.
 *
 * Computed once per finished month by the maintenance process from the
 * deduplicated catalog (`catalog_entries`: one row per vacancy cluster) and
 * the cluster salary evidence. Only ranges with an explicit provider period
 * enter a median (`parseEvidence`, the /salaries rule); every figure needs a
 * sample of at least MIN_REPORT_SAMPLE, otherwise it is not published.
 */
import type { DatabaseSync } from 'node:sqlite';
import { parseEvidence } from '../salaryMarket/salaryMarketRanges';
import { VACANCY_CLUSTERS_TABLE } from '../data/sqliteSchema';
import type { PublicPage } from '../../shared/publicPages';
import {
  MARKET_REPORTS_ROOT,
  MIN_REPORT_SAMPLE,
  marketReportPath,
  marketReportTitle,
  type MarketReport,
  type MarketReportSalaryGroup,
} from '../../shared/marketReport';

export const MARKET_REPORTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS market_reports (
  month TEXT PRIMARY KEY,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT`;

const TOP_ROLES = 10;
const BATCH = 500;

/** `YYYY-MM` of the last finished month in UTC. */
export function previousMonth(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return date.toISOString().slice(0, 7);
}

function monthBounds(month: string): { from: number; to: number } {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  return { from: Date.UTC(year, mon - 1, 1), to: Date.UTC(year, mon, 1) };
}

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function round(value: number): number {
  return value >= 10_000 ? Math.round(value / 100) * 100 : Math.round(value);
}

interface Row {
  readonly cluster_id: string;
  readonly is_remote: number;
  readonly role_slug: string | null;
  readonly role_label: string | null;
  readonly source_count: number;
  readonly salary_json: string | null;
}

interface Accumulator {
  vacancies: number;
  records: number;
  remote: number;
  withPeriodisedRange: number;
  roles: Map<string, { label: string; count: number }>;
  ranges: Map<string, { currency: string; period: string; low: number[]; high: number[] }>;
}

function add(acc: Accumulator, row: Row): void {
  acc.vacancies += 1;
  acc.records += row.source_count;
  acc.remote += row.is_remote;
  if (row.role_slug) {
    const role = acc.roles.get(row.role_slug) ?? {
      label: row.role_label ?? row.role_slug,
      count: 0,
    };
    acc.roles.set(row.role_slug, { ...role, count: role.count + 1 });
  }
  const range = parseEvidence(row.salary_json);
  if (typeof range === 'string') return;
  acc.withPeriodisedRange += 1;
  const key = `${range.currency}|${range.period}`;
  // Local accumulator of one computation: appending in place keeps it linear.
  const group = acc.ranges.get(key) ?? {
    currency: range.currency,
    period: range.period,
    low: [],
    high: [],
  };
  group.low.push(range.from);
  group.high.push(range.to);
  acc.ranges.set(key, group);
}

function salaryGroups(acc: Accumulator): {
  groups: MarketReportSalaryGroup[];
  hidden: number;
} {
  const all = [...acc.ranges.values()];
  const groups = all
    .filter((group) => group.low.length >= MIN_REPORT_SAMPLE)
    .map((group) => ({
      currency: group.currency,
      period: group.period as MarketReportSalaryGroup['period'],
      sample: group.low.length,
      medianLow: round(median([...group.low].sort((a, b) => a - b))),
      medianHigh: round(median([...group.high].sort((a, b) => a - b))),
    }))
    .sort((a, b) => b.sample - a.sample || a.currency.localeCompare(b.currency));
  return { groups, hidden: all.length - groups.length };
}

/** Reads the month in batches of BATCH rows; maintenance process only. */
export function computeMarketReport(
  database: DatabaseSync,
  month: string,
  now: Date,
): MarketReport {
  database.exec(VACANCY_CLUSTERS_TABLE);
  const { from, to } = monthBounds(month);
  const read = database.prepare(
    `SELECT e.cluster_id, e.is_remote, e.role_slug, e.role_label, e.source_count,
            json_extract(c.cluster_json, '$.salary') AS salary_json
       FROM catalog_entries e LEFT JOIN vacancy_clusters c ON c.id = e.cluster_id
      WHERE e.cluster_id > ? AND e.published_ms >= ? AND e.published_ms < ?
      ORDER BY e.cluster_id LIMIT ${BATCH}`,
  );
  const acc: Accumulator = {
    vacancies: 0,
    records: 0,
    remote: 0,
    withPeriodisedRange: 0,
    roles: new Map(),
    ranges: new Map(),
  };
  let cursor = '';
  for (;;) {
    const rows = read.all(cursor, from, to) as unknown as Row[];
    for (const row of rows) add(acc, row);
    if (rows.length < BATCH) break;
    cursor = rows.at(-1)!.cluster_id;
  }
  const { groups, hidden } = salaryGroups(acc);
  const topRoles = [...acc.roles.entries()]
    .map(([slug, role]) => ({ slug, label: role.label, count: role.count }))
    .filter((role) => role.count >= MIN_REPORT_SAMPLE)
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug))
    .slice(0, TOP_ROLES);
  return {
    month,
    generatedAt: now.toISOString().slice(0, 10),
    vacancies: acc.vacancies,
    sourceRecords: acc.records,
    remote: acc.vacancies >= MIN_REPORT_SAMPLE ? acc.remote : undefined,
    withPeriodisedRange: acc.withPeriodisedRange,
    salaryGroups: groups,
    hiddenSalaryGroups: hidden,
    topRoles,
  };
}

export function writeMarketReport(database: DatabaseSync, report: MarketReport): void {
  database.exec(MARKET_REPORTS_TABLE_SQL);
  database
    .prepare(
      `INSERT INTO market_reports (month, report_json, created_at) VALUES (?, ?, ?)
       ON CONFLICT(month) DO UPDATE SET report_json = excluded.report_json, created_at = excluded.created_at`,
    )
    .run(report.month, JSON.stringify(report), report.generatedAt);
}

function tableExists(database: DatabaseSync): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'market_reports'")
      .get(),
  );
}

/** Newest first. Works on a read-only handle: a missing table is no reports. */
export function readMarketReports(database: DatabaseSync): MarketReport[] {
  if (!tableExists(database)) return [];
  const rows = database
    .prepare('SELECT report_json FROM market_reports ORDER BY month DESC')
    .all() as Array<{ report_json: string }>;
  return rows.flatMap((row) => {
    try {
      return [JSON.parse(row.report_json) as MarketReport];
    } catch {
      return [];
    }
  });
}

/** A month with fewer vacancies than the sample floor gets no page. */
export function publishableReports(reports: readonly MarketReport[]): MarketReport[] {
  return reports.filter((report) => report.vacancies >= MIN_REPORT_SAMPLE);
}

export function reportPages(reports: readonly MarketReport[]): PublicPage[] {
  const published = publishableReports(reports);
  if (published.length === 0) return [];
  const hub: PublicPage = {
    path: MARKET_REPORTS_ROOT,
    title: 'Отчёты о рынке вакансий по месяцам',
    description:
      'Ежемесячные отчёты: число вакансий каталога, медианы зарплатных вилок с периодом оплаты, доля удалённых и топ ролей.',
    updatedAt: published[0]!.generatedAt,
    group: 'Отчёты о рынке',
  };
  return [
    hub,
    ...published.map((report) => ({
      path: marketReportPath(report.month),
      title: marketReportTitle(report.month),
      description: `Вакансии каталога openqareer за месяц: число, медианы зарплатных вилок с периодом оплаты, доля удалённых, топ ролей; выборка ${report.vacancies}.`,
      updatedAt: report.generatedAt,
      group: 'Отчёты о рынке' as const,
    })),
  ];
}

export function marketReportPages(database: DatabaseSync): PublicPage[] {
  return reportPages(readMarketReports(database));
}

/** Maintenance tick: builds the last finished month once. Returns true when it wrote. */
export function ensureMarketReport(database: DatabaseSync, now: Date): boolean {
  database.exec(MARKET_REPORTS_TABLE_SQL);
  const month = previousMonth(now);
  const exists = database.prepare('SELECT 1 FROM market_reports WHERE month = ?').get(month);
  if (exists) return false;
  writeMarketReport(database, computeMarketReport(database, month, now));
  return true;
}
