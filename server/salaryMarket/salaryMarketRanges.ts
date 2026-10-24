import type { DatabaseSync } from 'node:sqlite';
import type {
  SalaryMarketDistribution,
  SalaryMarketExclusions,
  SalaryMarketGroup,
  SalaryPercentiles,
} from '../../shared/salaryMarketSnapshot';
import { leverSalaryPeriod } from '../../shared/vacancySalaryPeriod';

import {
  MIN_SALARY_MARKET_SAMPLE,
  MAX_SALARY_MARKET_GROUPS,
} from '../../shared/salaryMarketSnapshot';
export type MutableExclusions = { -readonly [Key in keyof SalaryMarketExclusions]: number };
export function emptySalaryExclusions(): MutableExclusions {
  return {
    missingPeriod: 0,
    missingCurrency: 0,
    openRange: 0,
    invalidRange: 0,
    belowMinimumSample: 0,
  };
}

interface RangeEvidence {
  readonly from: number;
  readonly to: number;
  readonly currency: string;
  readonly period: 'hour' | 'month' | 'year';
  readonly taxBasis: 'gross' | 'net' | 'unknown';
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
function parseEvidence(
  json: string | null,
): RangeEvidence | 'missingPeriod' | 'missingCurrency' | 'openRange' | 'invalidRange' {
  let salary: Record<string, unknown>;
  try {
    salary = object(JSON.parse(json ?? '{}'));
  } catch {
    return 'invalidRange';
  }
  const evidence = object(salary.periodEvidence);
  const period =
    evidence.field === 'lever.salaryRange.interval' ? leverSalaryPeriod(evidence.value) : undefined;
  if (!period || period !== salary.period) return 'missingPeriod';
  if (typeof salary.currency !== 'string' || !/^[A-Z]{3}$/u.test(salary.currency))
    return 'missingCurrency';
  if (salary.from == null || salary.to == null) return 'openRange';
  if (
    typeof salary.from !== 'number' ||
    typeof salary.to !== 'number' ||
    !Number.isFinite(salary.from) ||
    !Number.isFinite(salary.to) ||
    salary.from <= 0 ||
    salary.to < salary.from
  )
    return 'invalidRange';
  return {
    from: salary.from,
    to: salary.to,
    currency: salary.currency,
    period,
    taxBasis: salary.gross === true ? 'gross' : salary.gross === false ? 'net' : 'unknown',
  };
}

export function prepareSalaryRangeScratch(database: DatabaseSync): void {
  database.exec(`CREATE TEMP TABLE salary_market_ranges (
    role TEXT NOT NULL, cluster_id TEXT NOT NULL, currency TEXT NOT NULL,
    period TEXT NOT NULL, tax_basis TEXT NOT NULL, low REAL NOT NULL, high REAL NOT NULL,
    PRIMARY KEY (role, cluster_id)
  ) WITHOUT ROWID;
  CREATE INDEX temp.salary_market_ranges_low ON salary_market_ranges(role, currency, period, tax_basis, low);
  CREATE INDEX temp.salary_market_ranges_high ON salary_market_ranges(role, currency, period, tax_basis, high)`);
}

export function recordSalaryRange(
  database: DatabaseSync,
  role: string,
  clusterId: string,
  json: string | null,
  excluded: MutableExclusions,
): void {
  const range = parseEvidence(json);
  if (typeof range === 'string') {
    excluded[range] += 1;
    return;
  }
  database
    .prepare('INSERT INTO salary_market_ranges VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(role, clusterId, range.currency, range.period, range.taxBasis, range.from, range.to);
}

interface SalaryGroupRow {
  readonly currency: string;
  readonly period: SalaryMarketGroup['period'];
  readonly taxBasis: SalaryMarketGroup['taxBasis'];
  readonly sampleSize: number;
}
function boundPercentiles(
  database: DatabaseSync,
  role: string,
  group: SalaryGroupRow,
  bound: 'low' | 'high',
): SalaryPercentiles {
  const query = database.prepare(`SELECT ${bound} AS value FROM salary_market_ranges
    WHERE role = ? AND currency = ? AND period = ? AND tax_basis = ? ORDER BY ${bound} LIMIT 1 OFFSET ?`);
  const percentile = (fraction: number) =>
    (
      query.get(
        role,
        group.currency,
        group.period,
        group.taxBasis,
        Math.ceil(fraction * group.sampleSize) - 1,
      ) as { value: number }
    ).value;
  return {
    p25: percentile(0.25),
    p50: percentile(0.5),
    p75: percentile(0.75),
    p90: percentile(0.9),
  };
}

export function salaryRangeDistribution(
  database: DatabaseSync,
  role: string,
  excluded: MutableExclusions,
): SalaryMarketDistribution {
  const candidates = database
    .prepare(
      `SELECT currency, period, tax_basis AS taxBasis, count(*) AS sampleSize
    FROM salary_market_ranges WHERE role = ? GROUP BY currency, period, tax_basis
    ORDER BY sampleSize DESC, currency, period, tax_basis`,
    )
    .iterate(role) as unknown as Iterable<SalaryGroupRow>;
  const groups: SalaryMarketGroup[] = [];
  let hasCandidates = false;
  for (const group of candidates) {
    hasCandidates = true;
    if (group.sampleSize < MIN_SALARY_MARKET_SAMPLE) {
      excluded.belowMinimumSample += group.sampleSize;
      continue;
    }
    if (groups.length >= MAX_SALARY_MARKET_GROUPS) {
      excluded.outsidePublishedGroups = (excluded.outsidePublishedGroups ?? 0) + group.sampleSize;
      continue;
    }
    groups.push({
      ...group,
      lower: boundPercentiles(database, role, group, 'low'),
      upper: boundPercentiles(database, role, group, 'high'),
    });
  }
  return groups.length > 0
    ? { status: 'available', methodology: 'published_range_bounds', groups, excluded }
    : {
        status: 'unavailable',
        reason:
          !hasCandidates && excluded.missingPeriod > 0
            ? 'missing_explicit_salary_period'
            : 'no_comparable_ranges',
        excluded,
      };
}
