/**
 * B643-8: `vacancy_company` for aggregator, hh and LinkedIn search rows. The
 * directory index is read in pages (165k companies, B644), then the live pool
 * is walked by id cursor in short transactions. A pass rewrites only rows
 * whose link changed; after the end it pauses 6 h and starts over, which also
 * covers rows taken in since the last pass. Rollback: OPENQAREER_AGGREGATOR_COMPANY_OFF=1.
 */
import type { DatabaseSync } from 'node:sqlite';
import { buildLinkageIndex, type DirectoryRow, type LinkageIndex } from './placementLinkage';
import { linkAggregatorRow } from './aggregatorLinkage';
import { PLACEMENT_TABLES } from './placementSchema';

export interface AggregatorBackfillReport {
  readonly done: boolean;
  readonly processed: number;
  readonly linked: number;
  readonly unlinked: number;
  readonly linkedTotal: number;
  readonly changedTotal: number;
  readonly ms: number;
}

const DIRECTORY_PAGE = 5_000;
const DEFAULT_CHUNK = 200;
export const AGGREGATOR_TICK_BUDGET_MS = 300;
export const AGGREGATOR_PASS_PAUSE_MS = 6 * 60 * 60_000;

interface PoolRow { id: string; source_id: string; company: string | null; person: number | null; employer: string | number | null }

export class AggregatorCompanyBackfill {
  private directory: DirectoryRow[] = [];
  private directoryCursor: string | undefined = '';
  private index: LinkageIndex | undefined;
  private names = new Map<string, string>();
  private hhEmployers = new Map<string, string>();
  private cursor = '';
  private linkedTotal = 0;
  private changedTotal = 0;
  private readonly chunk: number;
  private readonly now: () => number;

  constructor(private readonly db: DatabaseSync, options: { chunk?: number; now?: () => number } = {}) {
    this.chunk = options.chunk ?? DEFAULT_CHUNK;
    this.now = options.now ?? Date.now;
    db.exec(PLACEMENT_TABLES);
  }

  /** One page of the directory or one chunk of the pool. */
  step(): AggregatorBackfillReport {
    const startedAt = this.now();
    if (!this.index) return this.readDirectoryPage(startedAt);
    const rows = this.db
      .prepare(
        `SELECT i.id, i.source_id, json_extract(c.cluster_json,'$.company') AS company,
                json_extract(c.cluster_json,'$.employerIsPerson') AS person,
                json_extract(c.cluster_json,'$.employerId') AS employer
           FROM vacancy_pool_index i JOIN vacancy_cluster_input c ON c.id = i.id
          WHERE i.id > ? AND i.expired = 0 ORDER BY i.id LIMIT ?`,
      )
      .all(this.cursor, this.chunk) as unknown as PoolRow[];
    const { linked, unlinked } = this.write(rows);
    if (rows.length > 0) this.cursor = rows[rows.length - 1]!.id;
    const done = rows.length < this.chunk;
    const report = { done, processed: rows.length, linked, unlinked, linkedTotal: this.linkedTotal, changedTotal: this.changedTotal, ms: this.now() - startedAt };
    if (done) this.reset();
    return report;
  }

  private readDirectoryPage(startedAt: number): AggregatorBackfillReport {
    const page = this.db
      .prepare(
        `SELECT company_key AS companyKey, company_name AS companyName, website_url AS websiteUrl,
                ats_provider AS atsProvider, ats_slug AS atsSlug
           FROM company_directory WHERE company_key > ? ORDER BY company_key LIMIT ?`,
      )
      .all(this.directoryCursor ?? '', DIRECTORY_PAGE) as unknown as DirectoryRow[];
    this.directory.push(...page);
    this.directoryCursor = page.at(-1)?.companyKey ?? this.directoryCursor;
    if (page.length < DIRECTORY_PAGE) {
      this.index = buildLinkageIndex(this.directory);
      this.names = new Map(this.directory.map((row) => [row.companyKey, row.companyName]));
      this.hhEmployers = this.readHhEmployers();
      this.directory = [];
    }
    return { done: false, processed: 0, linked: 0, unlinked: 0, linkedTotal: this.linkedTotal, changedTotal: this.changedTotal, ms: this.now() - startedAt };
  }

  /** B643: hh employer id → company, from links on company sites (`hh:<id>` placements). */
  private readHhEmployers(): Map<string, string> {
    const rows = this.db
      .prepare(`SELECT substr(placement_id, 4) AS employerId, company_key AS companyKey FROM company_placement
                 WHERE placement_id LIKE 'hh:%' AND company_key IS NOT NULL`)
      .all() as unknown as { employerId: string; companyKey: string }[];
    return new Map(rows.map((row) => [row.employerId, row.companyKey]));
  }

  private write(rows: readonly PoolRow[]): { linked: number; unlinked: number } {
    const index = this.index!;
    const upsert = this.db.prepare(
      `INSERT INTO vacancy_company (vacancy_id, company_key, match_how, linked_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(vacancy_id) DO UPDATE SET company_key = excluded.company_key, match_how = excluded.match_how, linked_at = excluded.linked_at
       WHERE vacancy_company.company_key <> excluded.company_key OR vacancy_company.match_how <> excluded.match_how`,
    );
    const drop = this.db.prepare(`DELETE FROM vacancy_company WHERE vacancy_id = ?`);
    const nowMs = this.now();
    let linked = 0;
    let unlinked = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        const employerCompanyKey = row.employer === null ? undefined : this.hhEmployers.get(String(row.employer));
        const link = linkAggregatorRow(
          { sourceId: row.source_id, company: row.company, employerIsPerson: row.person === 1, employerCompanyKey },
          index,
          (key) => this.names.get(key),
        );
        if (link.status === 'linked') {
          linked += 1;
          this.changedTotal += Number(upsert.run(row.id, link.companyKey, link.how, nowMs).changes);
        } else {
          unlinked += 1;
          this.changedTotal += Number(drop.run(row.id).changes);
        }
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    this.linkedTotal += linked;
    return { linked, unlinked };
  }

  /** The next pass rereads the directory: companies added meanwhile take part. */
  private reset(): void {
    this.cursor = '';
    this.directoryCursor = '';
    this.index = undefined;
    this.names = new Map();
    this.hhEmployers = new Map();
    this.linkedTotal = 0;
    this.changedTotal = 0;
  }
}

export class AggregatorCompanyTicker {
  private nextPassAt = 0;

  constructor(
    private readonly backfill: Pick<AggregatorCompanyBackfill, 'step'>,
    private readonly now: () => number = Date.now,
  ) {}

  tick(): AggregatorBackfillReport | undefined {
    const startedAt = this.now();
    if (startedAt < this.nextPassAt) return undefined;
    while (this.now() - startedAt < AGGREGATOR_TICK_BUDGET_MS) {
      const report = this.backfill.step();
      if (report.done) {
        this.nextPassAt = this.now() + AGGREGATOR_PASS_PAUSE_MS;
        return report;
      }
    }
    return undefined;
  }
}
