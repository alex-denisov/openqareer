import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { readInWorker } from '../../data/readInWorker';
import { ADMIN_VACANCY_PAGE_BYTE_BUDGET } from '../../vacancies/adminVacancyPage';
import { PLACEMENT_TABLES } from '../placement/placementSchema';

/**
 * B643-10: how well the company directory is covered by employer-side sources.
 * A company is classified by its best placement (priority from B642
 * sourceKind(): site 1, ats 2, linkedin 3, aggregator 4). Companies without
 * placements are `aggregator_only` when aggregator rows link to them through
 * `vacancy_company`, otherwise `none`.
 *
 * Vacancy count = live rows of the pool index for the company's employer-side
 * sources + its `vacancy_company` links. The pool is aggregated by source in
 * per-source index range counts for employer-side placements only (aggregator
 * sources hold most of the pool and are never read), in a worker thread
 * (B230); totals are cached for ten minutes.
 */
export const COVERAGE_CLASSES = ['site', 'ats', 'linkedin_only', 'aggregator_only', 'none'] as const;
export type CoverageClass = (typeof COVERAGE_CLASSES)[number];

export const COVERAGE_TOTALS_TTL_MS = 10 * 60_000;

export interface CoverageTotals {
  readonly totalCompanies: number;
  readonly classes: Readonly<Record<CoverageClass, { companies: number; vacancies: number }>>;
  readonly computedAt: number;
}

export interface CoveragePlacement {
  readonly type: string;
  readonly id: string;
  readonly health: string | null;
  readonly lastCheckedAt: number | null;
}

export interface CoverageCompany {
  readonly companyKey: string;
  readonly name: string;
  readonly class: CoverageClass;
  readonly placements: readonly CoveragePlacement[];
  readonly vacancies: number;
}

export interface CoveragePage {
  readonly items: readonly CoverageCompany[];
  readonly nextCursor: string | null;
}

export interface CoverageCursor {
  readonly n: number;
  readonly key: string;
}

export function encodeCursor(cursor: CoverageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): CoverageCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { n, key } = parsed as { n?: unknown; key?: unknown };
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null;
    if (typeof key !== 'string' || key.length === 0 || key.length > 300) return null;
    return { n, key };
  } catch {
    return null;
  }
}

const BASE_CTE = `
WITH pl AS (
  SELECT p.company_key, MIN(p.priority) AS best,
         SUM(CASE WHEN p.priority < 4 THEN
           (SELECT COUNT(*) FROM vacancy_pool_index v WHERE v.source_id = p.source_id AND v.expired = 0)
           ELSE 0 END) AS board_n
  FROM company_placement p
  WHERE p.company_key IS NOT NULL GROUP BY p.company_key
), vc AS (
  SELECT company_key, COUNT(*) AS n FROM vacancy_company GROUP BY company_key
), base AS (
  SELECT d.company_key AS company_key, d.company_name AS name,
         CASE pl.best WHEN 1 THEN 'site' WHEN 2 THEN 'ats' WHEN 3 THEN 'linkedin_only'
           WHEN 4 THEN 'aggregator_only'
           ELSE CASE WHEN COALESCE(vc.n, 0) > 0 THEN 'aggregator_only' ELSE 'none' END END AS cls,
         COALESCE(pl.board_n, 0) + COALESCE(vc.n, 0) AS n
  FROM company_directory d
  LEFT JOIN pl ON pl.company_key = d.company_key
  LEFT JOIN vc ON vc.company_key = d.company_key
  WHERE d.status = 'active'
)`;

const TOTALS_SQL = `${BASE_CTE} SELECT cls, COUNT(*) AS companies, SUM(n) AS vacancies FROM base GROUP BY cls`;

interface ListRow {
  company_key: string;
  name: string;
  cls: CoverageClass;
  n: number;
}

interface PlacementRow {
  company_key: string;
  placement_id: string;
  type: string;
  health: string | null;
  last_checked_at: number | null;
}

/** Placements per row stay few; the page also stops at the admin byte budget. */
const PLACEMENTS_PER_COMPANY = 6;

export class CoverageReport {
  private cached: CoverageTotals | null = null;
  private inFlight: Promise<CoverageTotals> | null = null;
  private readonly now: () => number;

  constructor(
    private readonly database: DatabaseSync,
    options: { now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
    // Idempotent and instant: lets a read-only worker connection see the tables.
    database.exec(PLACEMENT_TABLES);
  }

  async totals(): Promise<CoverageTotals> {
    if (this.cached && this.now() - this.cached.computedAt < COVERAGE_TOTALS_TTL_MS) return this.cached;
    this.inFlight ??= this.computeTotals().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async computeTotals(): Promise<CoverageTotals> {
    const rows = await readInWorker<{ cls: CoverageClass; companies: number; vacancies: number }>(
      this.database,
      TOTALS_SQL,
    );
    const classes = Object.fromEntries(
      COVERAGE_CLASSES.map((cls) => [cls, { companies: 0, vacancies: 0 }]),
    ) as Record<CoverageClass, { companies: number; vacancies: number }>;
    for (const row of rows) {
      classes[row.cls] = { companies: row.companies, vacancies: row.vacancies ?? 0 };
    }
    const totalCompanies = COVERAGE_CLASSES.reduce((sum, cls) => sum + classes[cls].companies, 0);
    this.cached = { totalCompanies, classes, computedAt: this.now() };
    return this.cached;
  }

  async list(input: { limit: number; cls?: CoverageClass; cursor?: string }): Promise<CoveragePage> {
    const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor);
    if (input.cursor !== undefined && !cursor) throw new Error('invalid_cursor');
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (input.cls) {
      where.push('cls = ?');
      params.push(input.cls);
    }
    if (cursor) {
      where.push('(n < ? OR (n = ? AND company_key > ?))');
      params.push(cursor.n, cursor.n, cursor.key);
    }
    const sql = `${BASE_CTE} SELECT company_key, name, cls, n FROM base
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY n DESC, company_key ASC LIMIT ?`;
    const rows = await readInWorker<ListRow>(this.database, sql, [...params, input.limit + 1]);
    const pageRows = rows.slice(0, input.limit);
    const placements = await this.placementsFor(pageRows.map((row) => row.company_key));
    const items: CoverageCompany[] = [];
    let size = 2;
    for (const row of pageRows) {
      const item: CoverageCompany = {
        companyKey: row.company_key,
        name: row.name,
        class: row.cls,
        placements: (placements.get(row.company_key) ?? []).slice(0, PLACEMENTS_PER_COMPANY),
        vacancies: row.n,
      };
      const cost = Buffer.byteLength(JSON.stringify(item), 'utf8') + 1;
      // The admin proxy cuts bodies near 20 KB (INC-032): stop at the page budget,
      // a single oversized row still goes out so the list always advances.
      if (items.length > 0 && size + cost > ADMIN_VACANCY_PAGE_BYTE_BUDGET) break;
      items.push(item);
      size += cost;
    }
    const hasMore = rows.length > items.length;
    const last = pageRows[items.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor({ n: last.n, key: last.company_key }) : null,
    };
  }

  private async placementsFor(keys: readonly string[]): Promise<Map<string, CoveragePlacement[]>> {
    const byCompany = new Map<string, CoveragePlacement[]>();
    if (keys.length === 0) return byCompany;
    const rows = await readInWorker<PlacementRow>(
      this.database,
      `SELECT company_key, placement_id, type, health, last_checked_at FROM company_placement
       WHERE company_key IN (${keys.map(() => '?').join(',')}) ORDER BY company_key, priority, placement_id`,
      keys,
    );
    for (const row of rows) {
      const list = byCompany.get(row.company_key) ?? [];
      list.push({
        type: row.type,
        id: row.placement_id,
        health: row.health,
        lastCheckedAt: row.last_checked_at,
      });
      byCompany.set(row.company_key, list);
    }
    return byCompany;
  }
}
