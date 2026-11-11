import { CoverageReport } from '../companyDirectory/coverage/coverageReport';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { applySqliteBusyTimeout } from './sqliteBusyTimeout';
import {
  COMPANY_DIRECTORY_DEAD_ATS_BOARDS_MIGRATION,
  COMPANY_DIRECTORY_EVIDENCE_COLUMN,
  COMPANY_DIRECTORY_MIGRATION,
  COMPANY_DIRECTORY_TABLE,
} from './companyDirectorySchema';
import defaultCompanyDirectorySeed from './companyDirectorySeed.json';

export type CompanySourceType = 'corporate_portal' | 'ats_direct' | 'linkedin_guest';
export type CompanyDirectoryStatus = 'active' | 'dormant';

export interface CompanyDirectoryRecord {
  readonly companyKey: string;
  readonly companyName: string;
  readonly websiteUrl: string | null;
  readonly careersUrl: string | null;
  readonly linkedinUrl: string | null;
  readonly linkedinOrgId: string | null;
  readonly sourceType: CompanySourceType;
  readonly atsProvider: string | null;
  readonly atsSlug: string | null;
  readonly status: CompanyDirectoryStatus;
  readonly geo: string | null;
  readonly industry: string | null;
  readonly domainGroup: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Per-field provenance: { field: { value, how } }. */
  readonly evidence?: Readonly<Record<string, unknown>> | null;
}

export interface CompanyDirectoryFilter {
  readonly sourceType?: CompanySourceType;
  readonly status?: CompanyDirectoryStatus;
  readonly search?: string;
}

interface RawDirectoryRow {
  company_key: string;
  company_name: string;
  website_url: string | null;
  careers_url: string | null;
  linkedin_url: string | null;
  linkedin_org_id: string | null;
  source_type: string;
  ats_provider: string | null;
  ats_slug: string | null;
  status: string;
  geo: string | null;
  industry: string | null;
  domain_group: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  evidence?: string | null;
}

export type CompanyDirectoryRepoOptions =
  | DatabaseSync
  | { databasePath: string; autoSeed?: boolean };

const UPSERT_COMPANY_SQL = `
  INSERT INTO ${COMPANY_DIRECTORY_TABLE} (
    company_key, company_name, website_url, careers_url, linkedin_url,
    linkedin_org_id, source_type, ats_provider, ats_slug, status,
    geo, industry, domain_group, notes, created_at, updated_at, evidence
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(company_key) DO UPDATE SET
    company_name = excluded.company_name,
    website_url = COALESCE(excluded.website_url, ${COMPANY_DIRECTORY_TABLE}.website_url),
    careers_url = COALESCE(excluded.careers_url, ${COMPANY_DIRECTORY_TABLE}.careers_url),
    linkedin_url = COALESCE(excluded.linkedin_url, ${COMPANY_DIRECTORY_TABLE}.linkedin_url),
    linkedin_org_id = COALESCE(excluded.linkedin_org_id, ${COMPANY_DIRECTORY_TABLE}.linkedin_org_id),
    source_type = excluded.source_type,
    ats_provider = COALESCE(excluded.ats_provider, ${COMPANY_DIRECTORY_TABLE}.ats_provider),
    ats_slug = COALESCE(excluded.ats_slug, ${COMPANY_DIRECTORY_TABLE}.ats_slug),
    status = excluded.status,
    geo = COALESCE(excluded.geo, ${COMPANY_DIRECTORY_TABLE}.geo),
    industry = COALESCE(excluded.industry, ${COMPANY_DIRECTORY_TABLE}.industry),
    domain_group = COALESCE(excluded.domain_group, ${COMPANY_DIRECTORY_TABLE}.domain_group),
    notes = COALESCE(excluded.notes, ${COMPANY_DIRECTORY_TABLE}.notes),
    -- B643: the time careers_url changed, so old poll readings never judge a new URL.
    evidence = CASE WHEN excluded.careers_url IS NOT NULL AND excluded.careers_url IS NOT ${COMPANY_DIRECTORY_TABLE}.careers_url
      THEN json_set(COALESCE(excluded.evidence, ${COMPANY_DIRECTORY_TABLE}.evidence, '{}'), '$.careersUrlSetAt', excluded.updated_at)
      ELSE COALESCE(excluded.evidence, ${COMPANY_DIRECTORY_TABLE}.evidence) END,
    updated_at = excluded.updated_at;
`;

function companyToParams(record: CompanyDirectoryRecord) {
  return [
    record.companyKey,
    record.companyName,
    record.websiteUrl,
    record.careersUrl,
    record.linkedinUrl,
    record.linkedinOrgId,
    record.sourceType,
    record.atsProvider,
    record.atsSlug,
    record.status,
    record.geo,
    record.industry,
    record.domainGroup,
    record.notes,
    record.createdAt,
    record.updatedAt,
    record.evidence ? JSON.stringify(record.evidence) : null,
  ] as const;
}

function mapRowToRecord(row: RawDirectoryRow): CompanyDirectoryRecord {
  return {
    companyKey: row.company_key,
    companyName: row.company_name,
    websiteUrl: row.website_url,
    careersUrl: row.careers_url,
    linkedinUrl: row.linkedin_url,
    linkedinOrgId: row.linkedin_org_id,
    sourceType: (row.source_type as CompanySourceType) || 'corporate_portal',
    atsProvider: row.ats_provider,
    atsSlug: row.ats_slug,
    status: (row.status as CompanyDirectoryStatus) || 'active',
    geo: row.geo,
    industry: row.industry,
    domainGroup: row.domain_group,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    evidence: parseEvidence(row.evidence),
  };
}

function parseEvidence(raw: string | null | undefined): Readonly<Record<string, unknown>> | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function ensureEvidenceColumn(database: DatabaseSync): void {
  const columns = database
    .prepare(`PRAGMA table_info(${COMPANY_DIRECTORY_TABLE})`)
    .all() as unknown as { name: string }[];
  if (!columns.some((c) => c.name === COMPANY_DIRECTORY_EVIDENCE_COLUMN)) {
    database.exec(
      `ALTER TABLE ${COMPANY_DIRECTORY_TABLE} ADD COLUMN ${COMPANY_DIRECTORY_EVIDENCE_COLUMN} TEXT`,
    );
  }
}

export class SqliteCompanyDirectoryRepository {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;

  constructor(options: CompanyDirectoryRepoOptions) {
    if (options instanceof DatabaseSync) {
      this.database = options;
      this.ownsDatabase = false;
      this.database.exec(COMPANY_DIRECTORY_MIGRATION);
      this.database.exec(COMPANY_DIRECTORY_DEAD_ATS_BOARDS_MIGRATION);
      ensureEvidenceColumn(this.database);
    } else {
      if (options.databasePath !== ':memory:') {
        mkdirSync(dirname(options.databasePath), { recursive: true });
      }
      this.database = new DatabaseSync(options.databasePath);
      this.ownsDatabase = true;
      this.database.exec('PRAGMA journal_mode = WAL;');
      applySqliteBusyTimeout(this.database);
      this.database.exec('PRAGMA foreign_keys = ON;');
      this.database.exec(COMPANY_DIRECTORY_MIGRATION);
      this.database.exec(COMPANY_DIRECTORY_DEAD_ATS_BOARDS_MIGRATION);
      ensureEvidenceColumn(this.database);

      if (options.autoSeed ?? true) {
        this.seedDefaultsIfEmpty();
      }
    }
  }

  seedDefaultsIfEmpty(): number {
    const count = this.countCompanies();
    if (count > 0) return 0;
    this.upsertBatch(defaultCompanyDirectorySeed as unknown as readonly CompanyDirectoryRecord[]);
    return defaultCompanyDirectorySeed.length;
  }

  upsertCompany(record: CompanyDirectoryRecord): void {
    this.database.prepare(UPSERT_COMPANY_SQL).run(...companyToParams(record));
  }

  upsertBatch(records: readonly CompanyDirectoryRecord[]): void {
    if (records.length === 0) return;
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const stmt = this.database.prepare(UPSERT_COMPANY_SQL);
      for (const record of records) {
        stmt.run(...companyToParams(record));
      }
      this.database.exec('COMMIT;');
    } catch (err) {
      this.database.exec('ROLLBACK;');
      throw err;
    }
  }

  getCompany(companyKey: string): CompanyDirectoryRecord | undefined {
    const row = this.database
      .prepare(`SELECT * FROM ${COMPANY_DIRECTORY_TABLE} WHERE company_key = ?`)
      .get(companyKey) as RawDirectoryRow | undefined;
    return row ? mapRowToRecord(row) : undefined;
  }

  getCompanyByName(companyName: string): CompanyDirectoryRecord | undefined {
    const row = this.database
      .prepare(`SELECT * FROM ${COMPANY_DIRECTORY_TABLE} WHERE company_name = ? COLLATE NOCASE`)
      .get(companyName) as RawDirectoryRow | undefined;
    return row ? mapRowToRecord(row) : undefined;
  }

  listCompanies(filter?: CompanyDirectoryFilter): readonly CompanyDirectoryRecord[] {
    const conditions: string[] = [];
    const params: string[] = [];

    if (filter?.sourceType) {
      conditions.push('source_type = ?');
      params.push(filter.sourceType);
    }
    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.search) {
      conditions.push('(company_name LIKE ? OR company_key LIKE ?)');
      params.push(`%${filter.search}%`, `%${filter.search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.database
      .prepare(`SELECT * FROM ${COMPANY_DIRECTORY_TABLE} ${whereClause} ORDER BY company_name ASC`)
      .all(...params) as unknown as RawDirectoryRow[];

    return rows.map(mapRowToRecord);
  }

  countCompanies(): number {
    const result = this.database
      .prepare(`SELECT COUNT(*) as cnt FROM ${COMPANY_DIRECTORY_TABLE}`)
      .get() as { cnt: number };
    return result.cnt;
  }

  private coverage: CoverageReport | null = null;

  /** B643-10: admin coverage report; shares the 10-minute totals cache. */
  coverageReport(): CoverageReport {
    this.coverage ??= new CoverageReport(this.database);
    return this.coverage;
  }

  close(): void {
    if (this.ownsDatabase) {
      this.database.close();
    }
  }
}
