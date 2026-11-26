import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const ATS_PROVIDERS = [
  'greenhouse',
  'lever',
  'ashby',
  'workable',
  'recruitee',
  'smartrecruiters',
  'breezy',
  'pinpoint',
  'personio',
  'bamboohr',
  'teamtailor',
  'icims',
  'jobvite',
  'oracle',
  'paylocity',
  'join',
  'paycom',
  'workday',
] as const;
const PROFILE_FIELDS = [
  'websiteUrl',
  'careersUrl',
  'linkedinUrl',
  'linkedinOrgId',
  'geo',
  'industry',
  'domainGroup',
] as const;
const COMPANY_FIELDS = ['companyName', ...PROFILE_FIELDS, 'atsProvider', 'atsSlug'] as const;
const COMPANY_COLUMNS: Record<(typeof COMPANY_FIELDS)[number], string> = {
  companyName: 'company_name',
  websiteUrl: 'website_url',
  careersUrl: 'careers_url',
  linkedinUrl: 'linkedin_url',
  linkedinOrgId: 'linkedin_org_id',
  geo: 'geo',
  industry: 'industry',
  domainGroup: 'domain_group',
  atsProvider: 'ats_provider',
  atsSlug: 'ats_slug',
};
const string = z.string().refine((value) => value.trim() === value && value.length > 0);
const https = string.refine((value) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !url.port
    );
  } catch {
    return false;
  }
}, 'must be an HTTPS URL');
const SnapshotSchema = z
  .object({
    companyName: string,
    websiteUrl: z.string().nullable(),
    careersUrl: z.string().nullable(),
    linkedinUrl: z.string().nullable(),
    linkedinOrgId: z.string().nullable(),
    atsProvider: z.string().nullable(),
    atsSlug: z.string().nullable(),
    geo: z.string().nullable(),
    industry: z.string().nullable(),
    domainGroup: z.string().nullable(),
  })
  .strict();
const PlacementSnapshotSchema = z
  .object({
    placementId: string,
    companyKey: z.string().nullable(),
    type: string,
    provider: z.string().nullable(),
    slug: z.string().nullable(),
    url: z.string().nullable(),
    priority: z.number().safe().int(),
    sourceId: z.string().nullable(),
    discoveredBy: string,
    updatedAt: z.number().safe().int(),
  })
  .strict();
const RecordSchema = z
  .object({
    companyKey: string,
    companyName: string,
    expectedCompany: SnapshotSchema,
    profile: z
      .object({
        websiteUrl: https,
        careersUrl: https,
        linkedinUrl: https,
        linkedinOrgId: string,
        geo: string,
        industry: string,
        domainGroup: string,
      })
      .strict(),
    ats: z
      .object({
        provider: z.enum(ATS_PROVIDERS),
        slug: string,
        sourceId: string,
      })
      .strict(),
    evidence: z
      .object({
        verifiedAt: string,
        sourceUrls: z
          .object({
            websiteUrl: https,
            careersUrl: https,
            linkedinUrl: https,
            linkedinOrgId: https,
            geo: https,
            industry: https,
            domainGroup: https,
            atsBoardUrl: https,
          })
          .strict(),
      })
      .strict(),
    allowEmptyTechnicalAliasAdoption: z.boolean().optional(),
    expectedPlacement: PlacementSnapshotSchema.optional(),
  })
  .strict();
const ManifestSchema = z
  .object({
    version: z.literal(1),
    records: z.array(RecordSchema).min(1),
  })
  .strict();

type Snapshot = z.infer<typeof SnapshotSchema>;
type ImportRecord = z.infer<typeof RecordSchema>;
type ExpectedPlacement = z.infer<typeof PlacementSnapshotSchema>;
type CompanyRow = Snapshot & { status: string; evidence: string | null };
type PlacementRow = ExpectedPlacement & { evidence: string | null };
type PlacementAction = 'insert' | 'adopt-empty-alias' | 'confirm-exact';
type Plan = {
  record: ImportRecord;
  beforeCompany: CompanyRow;
  afterCompany: Snapshot;
  companyEvidence: string;
  beforePlacement: PlacementRow | null;
  placementId: string;
  placementAction: PlacementAction;
  placementEvidence: string;
  syncBefore: string | null;
  syncAfter: string;
  now: string;
};

const SELECT_COMPANY = `
  SELECT company_name AS companyName, website_url AS websiteUrl, careers_url AS careersUrl,
         linkedin_url AS linkedinUrl, linkedin_org_id AS linkedinOrgId, ats_provider AS atsProvider,
         ats_slug AS atsSlug, geo, industry, domain_group AS domainGroup, status, evidence
    FROM company_directory WHERE company_key = ?
`;
const SELECT_PLACEMENT = `
  SELECT placement_id AS placementId, company_key AS companyKey, type, provider, slug, url,
         priority, source_id AS sourceId, discovered_by AS discoveredBy, updated_at AS updatedAt, evidence
    FROM company_placement WHERE placement_id = ? OR source_id = ?
    ORDER BY CASE WHEN placement_id = ? THEN 0 ELSE 1 END LIMIT 2
`;

function validateAts(item: ImportRecord): void {
  if (item.ats.provider === 'workday')
    throw new Error('Workday multi-segment source IDs are not supported yet');
  if (!/^[A-Za-z0-9._~%-]+$/.test(item.ats.slug) || /%(?![0-9a-f]{2})/i.test(item.ats.slug)) {
    throw new Error(
      `${item.companyKey}: ATS slug must be one path segment with valid percent escapes`,
    );
  }
  if (item.ats.sourceId !== `ats-${item.ats.provider}-${item.ats.slug}`) {
    throw new Error(
      `${item.companyKey}: sourceId must exactly equal ats-${item.ats.provider}-${item.ats.slug}`,
    );
  }
  if (
    item.expectedCompany.atsProvider !== null &&
    item.expectedCompany.atsProvider !== item.ats.provider
  ) {
    throw new Error(`${item.companyKey}: refusing to reassign ats_provider`);
  }
  if (
    item.expectedCompany.atsSlug !== null &&
    item.expectedCompany.atsSlug.toLowerCase() !== item.ats.slug.toLowerCase()
  ) {
    throw new Error(`${item.companyKey}: refusing to reassign ats_slug`);
  }
}
function validateLinkedIn(item: ImportRecord): void {
  if (!/^\d+$/.test(item.profile.linkedinOrgId) || /^0+$/.test(item.profile.linkedinOrgId)) {
    throw new Error(`${item.companyKey}: LinkedIn organization ID must be positive numeric text`);
  }
  const url = new URL(item.profile.linkedinUrl);
  const companyJobs = /^\/company\/[^/]+\/jobs\/?$/i.test(url.pathname);
  const companySearch =
    url.pathname === '/jobs/search/' &&
    url.searchParams.getAll('f_C').includes(item.profile.linkedinOrgId);
  const hasKeywordSearch = [...url.searchParams.keys()].some(
    (key) => key.toLowerCase() === 'keywords',
  );
  if (
    !['linkedin.com', 'www.linkedin.com'].includes(url.hostname.toLowerCase()) ||
    (!companyJobs && !companySearch) ||
    hasKeywordSearch
  ) {
    throw new Error(
      `${item.companyKey}: LinkedIn URL must be company jobs or matching f_C search without keywords=`,
    );
  }
}
function validateEvidence(item: ImportRecord): void {
  const at = item.evidence.verifiedAt;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at) ||
    Number.isNaN(Date.parse(at)) ||
    new Date(at).toISOString() !== at
  ) {
    throw new Error(`${item.companyKey}: verifiedAt must be canonical ISO UTC with milliseconds`);
  }
  if (item.evidence.sourceUrls.atsBoardUrl !== item.profile.careersUrl) {
    throw new Error(`${item.companyKey}: ATS evidence URL must equal careersUrl`);
  }
}

function validateRecord(item: ImportRecord): void {
  if (item.companyName !== item.expectedCompany.companyName) {
    throw new Error(`${item.companyKey}: companyName must match expectedCompany.companyName`);
  }
  validateAts(item);
  validateLinkedIn(item);
  validateEvidence(item);
}

function parseManifest(input: unknown): ImportRecord[] {
  const records = Array.isArray(input)
    ? z.array(RecordSchema).min(1).parse(input)
    : ManifestSchema.parse(input).records;
  const seen = new Set<string>();
  for (const item of records) {
    validateRecord(item);
    for (const identity of [item.companyKey, item.ats.sourceId]) {
      if (seen.has(identity)) throw new Error(`manifest contains duplicate identity: ${identity}`);
      seen.add(identity);
    }
  }
  return records;
}

function assertColumns(db: DatabaseSync, table: string, required: string[]): void {
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map(
      (row) => row.name,
    ),
  );
  const missing = required.filter((column) => !columns.has(column));
  if (missing.length) throw new Error(`${table} missing columns: ${missing.join(', ')}`);
}
function assertSchema(db: DatabaseSync): void {
  assertColumns(db, 'company_directory', [
    'company_key',
    'company_name',
    'website_url',
    'careers_url',
    'linkedin_url',
    'linkedin_org_id',
    'ats_provider',
    'ats_slug',
    'geo',
    'industry',
    'domain_group',
    'status',
    'evidence',
    'updated_at',
  ]);
  assertColumns(db, 'company_placement', [
    'placement_id',
    'company_key',
    'type',
    'provider',
    'slug',
    'url',
    'priority',
    'source_id',
    'discovered_by',
    'updated_at',
    'evidence',
  ]);
  assertColumns(db, 'vacancy_source_state', [
    'source_id',
    'items_found_total',
    'items_active_total',
    'sync_requested_at',
  ]);
}
function readCompany(db: DatabaseSync, key: string): CompanyRow | null {
  return (db.prepare(SELECT_COMPANY).get(key) as unknown as CompanyRow | undefined) ?? null;
}
function readPlacement(db: DatabaseSync, id: string, sourceId: string): PlacementRow | null {
  const rows = db.prepare(SELECT_PLACEMENT).all(id, sourceId, id) as unknown as PlacementRow[];
  if (rows.length > 1) throw new Error(`${sourceId}: placement ID/source ID collision`);
  return rows[0] ?? null;
}
function readSync(db: DatabaseSync, sourceId: string): string | null {
  const row = db
    .prepare(
      'SELECT sync_requested_at AS requestedAt FROM vacancy_source_state WHERE source_id = ?',
    )
    .get(sourceId) as unknown as { requestedAt: string | null } | undefined;
  return row?.requestedAt ?? null;
}
function snapshot(row: CompanyRow): Snapshot {
  return Object.fromEntries(COMPANY_FIELDS.map((field) => [field, row[field]])) as Snapshot;
}
function placementSnapshot(row: PlacementRow): ExpectedPlacement {
  return {
    placementId: row.placementId,
    companyKey: row.companyKey,
    type: row.type,
    provider: row.provider,
    slug: row.slug,
    url: row.url,
    priority: row.priority,
    sourceId: row.sourceId,
    discoveredBy: row.discoveredBy,
    updatedAt: Number(row.updatedAt),
  };
}
function compareCompany(actual: CompanyRow, expected: Snapshot, key: string): void {
  for (const field of COMPANY_FIELDS) {
    if (actual[field] !== expected[field])
      throw new Error(`${key}: company ${field} compare-and-set failed`);
  }
  if (actual.status !== 'active') throw new Error(`${key}: company must already be active`);
}
function mergeEvidence(
  raw: string | null,
  verifiedImport: Record<string, unknown>,
  label: string,
): string {
  let existing: unknown = {};
  try {
    if (raw) existing = JSON.parse(raw);
  } catch {
    throw new Error(`${label} contains invalid evidence JSON`);
  }
  if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
    throw new Error(`${label} evidence must be a JSON object`);
  }
  return JSON.stringify({ ...(existing as Record<string, unknown>), verifiedImport });
}
function expectedPlacementId(item: ImportRecord): string {
  return `ats:${item.ats.provider}:${item.ats.slug.toLowerCase()}`;
}
function comparePlacementSnapshot(
  row: PlacementRow,
  expected: ExpectedPlacement,
  sourceId: string,
): void {
  const actual = placementSnapshot(row);
  for (const field of Object.keys(actual) as Array<keyof ExpectedPlacement>) {
    if (actual[field] !== expected[field]) {
      throw new Error(`${sourceId}: placement ${field} compare-and-set failed`);
    }
  }
}
function assertPlacementIdentity(row: PlacementRow, item: ImportRecord, id: string): void {
  const matches =
    row.placementId === id &&
    row.companyKey === item.companyKey &&
    row.type === 'ats' &&
    row.provider === item.ats.provider &&
    row.slug?.toLowerCase() === item.ats.slug.toLowerCase() &&
    (row.url === null || row.url === item.profile.careersUrl);
  if (!matches)
    throw new Error(`${item.ats.sourceId}: existing placement has a different identity`);
}
function placementAction(row: PlacementRow, item: ImportRecord): PlacementAction {
  if (row.sourceId === item.ats.sourceId) return 'confirm-exact';
  if (
    row.sourceId === null &&
    item.allowEmptyTechnicalAliasAdoption === true &&
    item.expectedPlacement?.sourceId === null
  )
    return 'adopt-empty-alias';
  throw new Error(`${item.ats.sourceId}: placement reassignment requires explicit empty-alias CAS`);
}

function planPlacement(
  db: DatabaseSync,
  item: ImportRecord,
  id: string,
  verifiedImport: Record<string, unknown>,
): Pick<Plan, 'beforePlacement' | 'placementAction' | 'placementEvidence'> {
  const beforePlacement = readPlacement(db, id, item.ats.sourceId);
  if (!beforePlacement) {
    if (item.expectedPlacement)
      throw new Error(`${item.ats.sourceId}: expected placement row is absent`);
    return {
      beforePlacement: null,
      placementAction: 'insert',
      placementEvidence: mergeEvidence(null, verifiedImport, item.ats.sourceId),
    };
  }
  if (item.expectedPlacement) {
    comparePlacementSnapshot(beforePlacement, item.expectedPlacement, item.ats.sourceId);
  }
  assertPlacementIdentity(beforePlacement, item, id);
  return {
    beforePlacement,
    placementAction: placementAction(beforePlacement, item),
    placementEvidence: mergeEvidence(beforePlacement.evidence, verifiedImport, item.ats.sourceId),
  };
}

function plan(db: DatabaseSync, item: ImportRecord, now: string): Plan {
  const beforeCompany = readCompany(db, item.companyKey);
  if (!beforeCompany)
    throw new Error(`${item.companyKey}: existing company_directory row required`);
  compareCompany(beforeCompany, item.expectedCompany, item.companyKey);
  const other = db
    .prepare(
      `SELECT company_key AS companyKey FROM company_directory
      WHERE ats_provider = ? AND lower(ats_slug) = lower(?) AND company_key <> ? LIMIT 1`,
    )
    .get(item.ats.provider, item.ats.slug, item.companyKey) as unknown as
    { companyKey: string } | undefined;
  if (other)
    throw new Error(`${item.ats.sourceId}: ATS board already assigned to ${other.companyKey}`);

  const afterCompany: Snapshot = {
    ...item.expectedCompany,
    ...item.profile,
    atsProvider: beforeCompany.atsProvider ?? item.ats.provider,
    atsSlug: beforeCompany.atsSlug ?? item.ats.slug,
  };
  const verifiedImport = {
    method: 'manual_verified_company_source_import',
    verifiedAt: item.evidence.verifiedAt,
    sourceId: item.ats.sourceId,
    provider: item.ats.provider,
    slug: item.ats.slug,
    boardUrl: item.profile.careersUrl,
    sourceUrls: item.evidence.sourceUrls,
  };
  const companyEvidence = mergeEvidence(beforeCompany.evidence, verifiedImport, item.companyKey);
  const id = expectedPlacementId(item);
  const placement = planPlacement(db, item, id, verifiedImport);
  const syncBefore = readSync(db, item.ats.sourceId);
  return {
    record: item,
    beforeCompany,
    afterCompany,
    companyEvidence,
    ...placement,
    placementId: id,
    syncBefore,
    syncAfter: syncBefore === null || syncBefore < now ? now : syncBefore,
    now,
  };
}
function updateCompany(db: DatabaseSync, item: Plan): void {
  const fields = [
    ['website_url', item.afterCompany.websiteUrl],
    ['careers_url', item.afterCompany.careersUrl],
    ['linkedin_url', item.afterCompany.linkedinUrl],
    ['linkedin_org_id', item.afterCompany.linkedinOrgId],
    ['ats_provider', item.afterCompany.atsProvider],
    ['ats_slug', item.afterCompany.atsSlug],
    ['geo', item.afterCompany.geo],
    ['industry', item.afterCompany.industry],
    ['domain_group', item.afterCompany.domainGroup],
  ] as const;
  const where = COMPANY_FIELDS.map((field) => `${COMPANY_COLUMNS[field]} IS ?`).join(' AND ');
  const result = db
    .prepare(
      `UPDATE company_directory SET ${fields.map(([column]) => `${column} = ?`).join(', ')},
       updated_at = ?, evidence = ?
     WHERE company_key = ? AND status = 'active' AND ${where}`,
    )
    .run(
      ...fields.map(([, value]) => value),
      item.now,
      item.companyEvidence,
      item.record.companyKey,
      ...COMPANY_FIELDS.map((field) => item.beforeCompany[field]),
    );
  if (Number(result.changes) !== 1)
    throw new Error(`${item.record.companyKey}: company CAS changed no row`);
}
function insertPlacement(db: DatabaseSync, item: Plan, updatedAt: number): void {
  const record = item.record;
  db.prepare(
    `INSERT INTO company_placement
       (placement_id, company_key, type, provider, slug, url, priority, source_id, discovered_by, evidence, updated_at)
     VALUES (?, ?, 'ats', ?, ?, ?, 2, ?, 'manual_verified_import', ?, ?)`,
  ).run(
    item.placementId,
    record.companyKey,
    record.ats.provider,
    record.ats.slug.toLowerCase(),
    record.profile.careersUrl,
    record.ats.sourceId,
    item.placementEvidence,
    updatedAt,
  );
}
function updateExistingPlacement(db: DatabaseSync, item: Plan, updatedAt: number): void {
  const before = item.beforePlacement;
  if (!before) throw new Error(`${item.record.ats.sourceId}: placement disappeared`);
  const exact = item.placementAction === 'confirm-exact';
  const sourceWhere = exact ? 'source_id = ?' : 'source_id IS NULL';
  const sourceParam = exact ? [item.record.ats.sourceId] : [];
  const result = db
    .prepare(
      `UPDATE company_placement SET source_id = ?, url = ?, evidence = ?, updated_at = ?
      WHERE placement_id = ? AND company_key = ? AND type = 'ats' AND provider = ?
        AND lower(slug) = lower(?) AND updated_at = ? AND url IS ? AND priority = ?
        AND discovered_by = ? AND ${sourceWhere}`,
    )
    .run(
      item.record.ats.sourceId,
      item.record.profile.careersUrl,
      item.placementEvidence,
      updatedAt,
      item.placementId,
      item.record.companyKey,
      item.record.ats.provider,
      item.record.ats.slug,
      before.updatedAt,
      before.url,
      before.priority,
      before.discoveredBy,
      ...sourceParam,
    );
  if (Number(result.changes) !== 1) {
    throw new Error(`${item.record.ats.sourceId}: placement CAS changed no row`);
  }
}

function updatePlacement(db: DatabaseSync, item: Plan): void {
  const updatedAt = Date.parse(item.now);
  if (!Number.isSafeInteger(updatedAt))
    throw new Error('timestamp is outside the safe integer range');
  if (item.placementAction === 'insert') {
    insertPlacement(db, item, updatedAt);
    return;
  }
  updateExistingPlacement(db, item, updatedAt);
}
function requestSync(db: DatabaseSync, sourceId: string, requestedAt: string): void {
  db.prepare(
    `INSERT INTO vacancy_source_state
       (source_id, items_found_total, items_active_total, sync_requested_at) VALUES (?, 0, 0, ?)
     ON CONFLICT(source_id) DO UPDATE SET
       sync_requested_at = CASE
         WHEN vacancy_source_state.sync_requested_at IS NULL
           OR vacancy_source_state.sync_requested_at < excluded.sync_requested_at
         THEN excluded.sync_requested_at ELSE vacancy_source_state.sync_requested_at END`,
  ).run(sourceId, requestedAt);
}
function afterCheck(db: DatabaseSync, item: Plan): ExpectedPlacement {
  const company = readCompany(db, item.record.companyKey);
  if (!company) throw new Error(`${item.record.companyKey}: company after-check failed`);
  compareCompany(company, item.afterCompany, item.record.companyKey);
  const directoryEvidence = JSON.parse(company.evidence ?? '{}') as Record<string, unknown>;
  if (!directoryEvidence.verifiedImport)
    throw new Error(`${item.record.companyKey}: evidence after-check failed`);
  const placement = readPlacement(db, item.placementId, item.record.ats.sourceId);
  if (
    !placement ||
    placement.sourceId !== item.record.ats.sourceId ||
    placement.companyKey !== item.record.companyKey ||
    placement.type !== 'ats' ||
    placement.provider !== item.record.ats.provider ||
    placement.slug?.toLowerCase() !== item.record.ats.slug.toLowerCase() ||
    placement.url !== item.record.profile.careersUrl
  ) {
    throw new Error(`${item.record.ats.sourceId}: exact placement after-check failed`);
  }
  const placementEvidence = JSON.parse(placement.evidence ?? '{}') as Record<string, unknown>;
  const verifiedImport = placementEvidence.verifiedImport;
  if (!isObject(verifiedImport) || verifiedImport.sourceId !== item.record.ats.sourceId) {
    throw new Error(`${item.record.ats.sourceId}: placement evidence after-check failed`);
  }
  const state = db
    .prepare(
      'SELECT sync_requested_at AS requestedAt FROM vacancy_source_state WHERE source_id = ?',
    )
    .get(item.record.ats.sourceId) as unknown as { requestedAt: string | null } | undefined;
  if (state?.requestedAt !== item.syncAfter)
    throw new Error(`${item.record.ats.sourceId}: sync after-check failed`);
  return placementSnapshot(placement);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function report(item: Plan, status: 'would-apply' | 'applied', placementAfter?: ExpectedPlacement) {
  return {
    companyKey: item.record.companyKey,
    sourceId: item.record.ats.sourceId,
    status,
    before: {
      company: snapshot(item.beforeCompany),
      placement: item.beforePlacement ? placementSnapshot(item.beforePlacement) : null,
      syncRequestedAt: item.syncBefore,
    },
    after: {
      company: item.afterCompany,
      placement: placementAfter ?? {
        placementId: item.placementId,
        companyKey: item.record.companyKey,
        type: 'ats',
        provider: item.record.ats.provider,
        slug: item.record.ats.slug.toLowerCase(),
        url: item.record.profile.careersUrl,
        priority: 2,
        sourceId: item.record.ats.sourceId,
        discoveredBy: item.beforePlacement?.discoveredBy ?? 'manual_verified_import',
        updatedAt: Date.parse(item.now),
      },
      syncRequestedAt: item.syncAfter,
    },
  };
}
function applyPlans(db: DatabaseSync, plans: Plan[]) {
  for (const item of plans) {
    updateCompany(db, item);
    updatePlacement(db, item);
    requestSync(db, item.record.ats.sourceId, item.now);
  }
  return plans.map((item) => report(item, 'applied', afterCheck(db, item)));
}

export function importVerifiedCompanySources(
  db: DatabaseSync,
  input: unknown,
  apply = false,
  now = new Date().toISOString(),
) {
  const records = parseManifest(input);
  if (Number.isNaN(Date.parse(now)) || new Date(now).toISOString() !== now) {
    throw new Error('now must be a canonical ISO UTC timestamp');
  }
  assertSchema(db);
  db.exec(apply ? 'BEGIN IMMEDIATE' : 'BEGIN');
  let open = true;
  try {
    const plans = records.map((record) => plan(db, record, now));
    const results = apply
      ? applyPlans(db, plans)
      : plans.map((item) => report(item, 'would-apply'));
    db.exec(apply ? 'COMMIT' : 'ROLLBACK');
    open = false;
    return results;
  } catch (error) {
    if (open) db.exec('ROLLBACK');
    throw error;
  }
}

function usage(): void {
  process.stdout.write(
    'Usage: npx tsx scripts/import-verified-company-sources.ts --db <sqlite-file> --input <manifest.json> [--apply]\n' +
      'Dry-run is the default and opens the database read-only; --apply writes the batch.\n' +
      'Only existing active company rows are updated. Each record needs a current company snapshot,\n' +
      'seven verified profile fields, evidence URLs, and an exact ATS sourceId.\n',
  );
}
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return usage();
  let dbPath: string | undefined;
  let inputPath: string | undefined;
  let apply = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--apply') apply = true;
    else if (args[i] === '--dry-run') {
      if (apply) throw new Error('--apply and --dry-run cannot be combined');
    } else if (args[i] === '--db' || args[i] === '--input') {
      const path = args[i + 1];
      if (!path || path.startsWith('--')) throw new Error(`${args[i]} requires a path`);
      if (args[i] === '--db') dbPath = path;
      else inputPath = path;
      i += 1;
    } else throw new Error(`unknown argument: ${args[i]}`);
  }
  if (!dbPath || !inputPath) throw new Error('both --db and --input are required');
  const databasePath = resolve(dbPath);
  const manifestPath = resolve(inputPath);
  if (!existsSync(databasePath) || !statSync(databasePath).isFile())
    throw new Error(`database does not exist: ${databasePath}`);
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile())
    throw new Error(`manifest does not exist: ${manifestPath}`);

  const db = new DatabaseSync(databasePath, { readOnly: !apply, timeout: 5000 });
  try {
    const records = importVerifiedCompanySources(
      db,
      JSON.parse(readFileSync(manifestPath, 'utf8')),
      apply,
    );
    process.stdout.write(
      JSON.stringify(
        {
          mode: apply ? 'apply' : 'dry-run',
          database: databasePath,
          input: manifestPath,
          records,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    db.close();
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `Verified source import failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
