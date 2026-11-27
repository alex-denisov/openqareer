import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  COMPANY_DIRECTORY_EVIDENCE_COLUMN,
  COMPANY_DIRECTORY_MIGRATION,
  COMPANY_DIRECTORY_TABLE,
} from '../../../../data/companyDirectorySchema';
import { MIGRATION_23, VACANCY_CATALOG_ENTRIES_TABLE, VACANCY_CLUSTERS_TABLE, VACANCY_CLUSTER_INPUT_TABLE, VACANCY_CLUSTER_KEYS_TABLE, VACANCY_POOL_INDEX_TABLE } from '../../../../data/sqliteSchema';
import { DIRECT_ATS_CHECK_TABLE } from '../../../../companyDirectory/siteDiscovery/directAtsDiscovery';
import { PLACEMENT_TABLES } from '../../../../companyDirectory/placement/placementSchema';
import { VACANCY_DEMAND_TABLE_SQL } from '../../../vacancyDemandStore';

export const FREEHIRE_CANDIDATES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS freehire_company_source_candidates (
  slug TEXT PRIMARY KEY,
  evidence TEXT NOT NULL,
  fetched_at TEXT NOT NULL
) STRICT`;

const trackedDbs: DatabaseSync[] = [];
const trackedDirs: string[] = [];

function ensureEvidenceColumn(db: DatabaseSync): void {
  const cols = db
    .prepare(`PRAGMA table_info(${COMPANY_DIRECTORY_TABLE})`)
    .all() as unknown as { name: string }[];
  if (!cols.some((c) => c.name === COMPANY_DIRECTORY_EVIDENCE_COLUMN)) {
    db.exec(`ALTER TABLE ${COMPANY_DIRECTORY_TABLE} ADD COLUMN ${COMPANY_DIRECTORY_EVIDENCE_COLUMN} TEXT`);
  }
}

export function bootstrapE2eSchema(db: DatabaseSync): void {
  db.exec(COMPANY_DIRECTORY_MIGRATION);
  ensureEvidenceColumn(db);
  db.exec(PLACEMENT_TABLES);
  db.exec(FREEHIRE_CANDIDATES_TABLE_SQL);
  db.exec(VACANCY_DEMAND_TABLE_SQL);
  db.exec(DIRECT_ATS_CHECK_TABLE);
}

export function bootstrapPoolTables(db: DatabaseSync): void {
  db.exec(MIGRATION_23);
  db.exec(VACANCY_CLUSTERS_TABLE);
  db.exec(VACANCY_CLUSTER_INPUT_TABLE);
  db.exec(VACANCY_POOL_INDEX_TABLE);
  db.exec(VACANCY_CATALOG_ENTRIES_TABLE);
  db.exec(VACANCY_CLUSTER_KEYS_TABLE);
}

export function createMemoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  trackedDbs.push(db);
  bootstrapE2eSchema(db);
  return db;
}

export interface TempDbWorkspace {
  readonly dir: string;
  readonly dbPath: string;
  openDb(bootstrap?: boolean): DatabaseSync;
  cleanup(): void;
}

export function createTempDbWorkspace(prefix = 'oq-e2e-'): TempDbWorkspace {
  const base = process.env.OQ_TEST_SCRATCH_DIR || tmpdir();
  if (!existsSync(base)) mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, prefix));
  trackedDirs.push(dir);
  const dbPath = join(dir, 'e2e.sqlite');
  const opened: DatabaseSync[] = [];
  return {
    dir,
    dbPath,
    openDb: (bootstrap = true) => {
      const db = new DatabaseSync(dbPath);
      if (bootstrap) bootstrapE2eSchema(db);
      opened.push(db);
      trackedDbs.push(db);
      return db;
    },
    cleanup: () => {
      for (const db of opened) {
        try {
          db.close();
        } catch {
          // ignore already closed
        }
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function cleanupAllSqliteHarnesses(): void {
  while (trackedDbs.length > 0) {
    const db = trackedDbs.pop();
    try {
      db?.close();
    } catch {
      // ignore already closed
    }
  }
  while (trackedDirs.length > 0) {
    const dir = trackedDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

export interface SeedCompanyInput {
  readonly companyKey: string;
  readonly companyName: string;
  readonly websiteUrl?: string | null;
  readonly careersUrl?: string | null;
  readonly linkedinUrl?: string | null;
  readonly linkedinOrgId?: string | null;
  readonly sourceType?: string;
  readonly atsProvider?: string | null;
  readonly atsSlug?: string | null;
  readonly status?: string;
  readonly geo?: string | null;
  readonly industry?: string | null;
  readonly domainGroup?: string | null;
  readonly evidence?: Readonly<Record<string, unknown>> | null;
  readonly updatedAt?: string;
}

export function seedDirectoryCompany(db: DatabaseSync, input: SeedCompanyInput): void {
  const stamp = input.updatedAt ?? '2026-11-20T00:00:00Z';
  db.prepare(
    `INSERT INTO company_directory (
       company_key, company_name, website_url, careers_url, linkedin_url,
       linkedin_org_id, source_type, ats_provider, ats_slug, status,
       geo, industry, domain_group, notes, created_at, updated_at, evidence
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  ).run(
    input.companyKey,
    input.companyName,
    input.websiteUrl ?? null,
    input.careersUrl ?? null,
    input.linkedinUrl ?? null,
    input.linkedinOrgId ?? null,
    input.sourceType ?? 'corporate_portal',
    input.atsProvider ?? null,
    input.atsSlug ?? null,
    input.status ?? 'active',
    input.geo ?? null,
    input.industry ?? null,
    input.domainGroup ?? null,
    stamp,
    stamp,
    input.evidence ? JSON.stringify(input.evidence) : null,
  );
}

export interface SeedPlacementInput {
  readonly placementId: string;
  readonly companyKey?: string | null;
  readonly type: string;
  readonly provider?: string | null;
  readonly slug?: string | null;
  readonly url?: string | null;
  readonly priority?: number;
  readonly sourceId?: string | null;
  readonly health?: string | null;
  readonly discoveredBy?: string;
  readonly updatedAt?: number;
}

export function seedPlacement(db: DatabaseSync, input: SeedPlacementInput): void {
  db.prepare(
    `INSERT INTO company_placement (
       placement_id, company_key, type, provider, slug, url,
       priority, source_id, health, discovered_by, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.placementId,
    input.companyKey ?? null,
    input.type,
    input.provider ?? null,
    input.slug ?? null,
    input.url ?? null,
    input.priority ?? 2,
    input.sourceId ?? null,
    input.health ?? null,
    input.discoveredBy ?? 'freehire',
    input.updatedAt ?? Date.UTC(2026, 10, 20),
  );
}

export function seedFreehireCandidate(
  db: DatabaseSync,
  slug: string,
  evidence: unknown,
  fetchedAt = '2026-11-20T00:00:00Z',
): void {
  const payload = typeof evidence === 'string' ? evidence : JSON.stringify(evidence);
  db.prepare(
    `INSERT INTO freehire_company_source_candidates (slug, evidence, fetched_at) VALUES (?, ?, ?)`,
  ).run(slug, payload, fetchedAt);
}

export interface SeedSourceStateInput {
  readonly sourceId: string;
  readonly lastSyncAt?: string | null;
  readonly lastStatus?: string | null;
  readonly lastErrorMessage?: string | null;
  readonly itemsFoundTotal?: number;
  readonly itemsActiveTotal?: number;
  readonly observations?: unknown;
}

export function seedSourceState(db: DatabaseSync, input: SeedSourceStateInput): void {
  const obs =
    input.observations === undefined || input.observations === null
      ? null
      : typeof input.observations === 'string'
        ? input.observations
        : JSON.stringify(input.observations);
  db.prepare(
    `INSERT OR REPLACE INTO vacancy_source_state (
       source_id, last_sync_at, last_status, last_error_message,
       items_found_total, items_active_total, observations
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.sourceId,
    input.lastSyncAt ?? '2026-11-20T00:00:00Z',
    input.lastStatus ?? 'healthy',
    input.lastErrorMessage ?? null,
    input.itemsFoundTotal ?? 0,
    input.itemsActiveTotal ?? 0,
    obs,
  );
}

export function seedVacancyCompany(db: DatabaseSync, vacancyId: string, companyKey: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO vacancy_company (vacancy_id, company_key, match_how, linked_at)
     VALUES (?, ?, 'exact_name', ?)`,
  ).run(vacancyId, companyKey, Date.UTC(2026, 10, 20));
}
