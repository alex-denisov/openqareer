import {
  accrueSalarySkillHistory,
  SALARY_SKILL_HISTORY_TABLE_SQL,
} from './salaryMarketSkillHistory';
import {
  prepareClassifiedSalaryCatalog,
  selectClassifiedSalaryRoles,
  classifiedSalaryPage,
  type ClassifiedSalaryRow,
} from './salaryMarketClassifiedCatalog';
import {
  salaryGeography,
  salaryLocationCohortKey,
  SALARY_REGIONAL_LOCATIONS,
  type SalaryRegionalLocation,
} from './salaryMarketGeography';
import { prepareSalarySkillCounts, salarySkillsOf } from './salaryMarketSkillCounts';
import {
  SALARY_MARKET_INDEX_LIMIT,
  salarySnapshotIndexable,
  type SalaryMarketIndexEntry,
  type SalaryMarketGrade,
  type SalaryMarketProfession,
  type SalaryMarketGeographyEvidence,
} from '../../shared/salaryMarketSnapshot';
import {
  emptySalaryExclusions,
  prepareSalaryRangeScratch,
  recordSalaryRange,
  salaryRangeDistribution,
  type MutableExclusions,
} from './salaryMarketRanges';
import type { DatabaseSync } from 'node:sqlite';
import type { SalaryMarketSnapshot, SalaryObservation } from '../../shared/salaryMarketSnapshot';

export const SALARY_MARKET_TABLE_SQL = `CREATE TABLE IF NOT EXISTS salary_market_snapshots (
  role TEXT PRIMARY KEY,
  payload TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS salary_market_index (
  id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL
) STRICT`;

/** Nearest-rank percentiles. Callers must supply a single comparable evidence group. */
export function salaryPercentiles(observations: readonly SalaryObservation[]) {
  const first = observations[0];
  if (new Set(observations.map((row) => row.clusterId)).size !== observations.length) return null;
  if (!first || !/^[A-Z]{3}$/u.test(first.currency)) return null;
  if (
    observations.some(
      (row) =>
        !Number.isFinite(row.amount) ||
        row.amount <= 0 ||
        row.currency !== first.currency ||
        row.period !== first.period ||
        row.gross !== first.gross,
    )
  )
    return null;
  const sorted = observations.map((row) => row.amount).sort((a, b) => a - b);
  const percentile = (rank: number) => sorted[Math.ceil(rank * sorted.length) - 1]!;
  return {
    p25: percentile(0.25),
    p50: percentile(0.5),
    p75: percentile(0.75),
    p90: percentile(0.9),
  };
}

interface SliceState {
  count: number;
  excluded: MutableExclusions;
  markers: Set<string>;
}
interface CohortState extends SliceState {
  readonly gradeStates: Map<SalaryMarketGrade, SliceState>;
}
interface RoleState extends CohortState {
  readonly label: string;
  readonly profession: SalaryMarketProfession;
  readonly locationStates: Map<SalaryRegionalLocation, CohortState>;
  readonly geography: {
    -readonly [K in keyof SalaryMarketGeographyEvidence]: SalaryMarketGeographyEvidence[K];
  };
}
function sliceState(): SliceState {
  return { count: 0, excluded: emptySalaryExclusions(), markers: new Set() };
}
function roleState(row: ClassifiedSalaryRow): RoleState {
  const profession: SalaryMarketProfession = row.profession_id
    ? { kind: 'b267', roleId: row.profession_id, matchedAlias: row.matched_alias ?? undefined }
    : { kind: 'unclassified_title' };
  return {
    ...cohortState(),
    label: row.role_label,
    profession,
    locationStates: new Map(),
    geography: {
      method: 'explicit_source_country_v1',
      regionPolicy: 'openqareer_candidate_regions_v1',
      explicitCountryCount: 0,
      unknownCountryCount: 0,
      ambiguousCountryCount: 0,
      remoteCount: 0,
    },
  };
}
function cohortState(): CohortState {
  return { ...sliceState(), gradeStates: new Map() };
}
type SkillCounter = ReturnType<typeof prepareSalarySkillCounts>;
function recordObservation(
  database: DatabaseSync,
  skills: SkillCounter,
  key: string,
  row: ClassifiedSalaryRow,
  state: SliceState,
  names: readonly string[],
): void {
  state.count += 1;
  recordSalaryRange(database, key, row.cluster_id, row.salary_json, state.excluded);
  skills.add(key, names);
  if (row.marker && state.markers.size < 8) state.markers.add(row.marker);
}
function recordCohort(
  database: DatabaseSync,
  skills: SkillCounter,
  key: string,
  row: ClassifiedSalaryRow,
  state: CohortState,
  names: readonly string[],
): void {
  recordObservation(database, skills, key, row, state, names);
  const grade = state.gradeStates.get(row.grade) ?? sliceState();
  recordObservation(database, skills, `${key}|${row.grade}`, row, grade, names);
  state.gradeStates.set(row.grade, grade);
}
function accumulateClassifiedRoles(
  database: DatabaseSync,
  skills: SkillCounter,
  roles: readonly string[],
): Map<string, RoleState> {
  const groups = new Map<string, RoleState>();
  let cursor = '';
  while (true) {
    const rows = classifiedSalaryPage(database, roles, cursor);
    if (rows.length === 0) break;
    for (const row of rows) {
      const group = groups.get(row.role) ?? roleState(row);
      const names = salarySkillsOf(row.skills_json);
      recordCohort(database, skills, row.role, row, group, names);
      const geography = salaryGeography(row.location, row.is_remote === 1);
      if (geography.status === 'explicit_country') group.geography.explicitCountryCount += 1;
      else if (geography.status === 'ambiguous_country') group.geography.ambiguousCountryCount += 1;
      else group.geography.unknownCountryCount += 1;
      if (row.is_remote === 1) group.geography.remoteCount += 1;
      for (const location of geography.locations) {
        const state = group.locationStates.get(location) ?? cohortState();
        recordCohort(
          database,
          skills,
          salaryLocationCohortKey(row.role, location),
          row,
          state,
          names,
        );
        group.locationStates.set(location, state);
      }
      groups.set(row.role, group);
    }
    cursor = rows[rows.length - 1]!.cluster_id;
  }
  return groups;
}
function assembleCohort(
  database: DatabaseSync,
  skills: SkillCounter,
  key: string,
  state: CohortState,
) {
  if (state.count === 0)
    return {
      sampleSize: 0,
      skills: [],
      gradeSlices: [],
      quarterlyTrend: 'unavailable' as const,
      salary: {
        status: 'unavailable' as const,
        reason: 'no_comparable_ranges' as const,
        excluded: state.excluded,
      },
    };
  const gradeSlices = [...state.gradeStates.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([grade, slice]) => ({
      grade,
      sampleSize: slice.count,
      skills: skills.read(`${key}|${grade}`, slice.count),
      salary: salaryRangeDistribution(database, `${key}|${grade}`, slice.excluded),
      evidence: { field: 'title' as const, markers: [...slice.markers] },
    }));
  return {
    sampleSize: state.count,
    skills: skills.read(key, state.count),
    salary: salaryRangeDistribution(database, key, state.excluded),
    gradeSlices,
    quarterlyTrend: 'unavailable' as const,
  };
}

function assembleRoleSnapshot(
  database: DatabaseSync,
  skills: SkillCounter,
  role: string,
  group: RoleState,
  now: Date,
): SalaryMarketSnapshot {
  const all = assembleCohort(database, skills, role, group);
  return {
    role,
    roleLabel: group.label,
    profession: group.profession,
    updatedAt: now.toISOString(),
    windowDays: 90,
    ...all,
    grades: all.gradeSlices.some((slice) => slice.grade !== 'unknown')
      ? 'published_title_evidence'
      : 'unavailable',
    source: 'deduplicated_public_catalog',
    geography: group.geography,
    locationSlices: SALARY_REGIONAL_LOCATIONS.map((location) => ({
      location,
      evidenceMethod:
        location === 'remote' ? 'stored_remote_flag_v1' : 'explicit_source_country_v1',
      ...assembleCohort(
        database,
        skills,
        salaryLocationCohortKey(role, location),
        group.locationStates.get(location) ?? cohortState(),
      ),
    })),
  };
}

/** Classification is disk-backed before the bounded role publication decision, never on HTTP. */
function buildSalaryMarketSnapshots(database: DatabaseSync, now: Date): SalaryMarketSnapshot[] {
  prepareClassifiedSalaryCatalog(database, now);
  const roles = selectClassifiedSalaryRoles(database);
  if (roles.length === 0) return [];
  const skills = prepareSalarySkillCounts(database);
  prepareSalaryRangeScratch(database);
  return [...accumulateClassifiedRoles(database, skills, roles)].map(([role, state]) =>
    assembleRoleSnapshot(database, skills, role, state, now),
  );
}

/** Always release the maintenance-only scratch vocabulary, including after failed writes. */
export function computeSalaryMarketSnapshots(
  database: DatabaseSync,
  now: Date,
): SalaryMarketSnapshot[] {
  try {
    return buildSalaryMarketSnapshots(database, now);
  } finally {
    database.exec(
      'DROP TABLE IF EXISTS temp.salary_market_skill_counts; DROP TABLE IF EXISTS temp.salary_market_ranges; DROP TABLE IF EXISTS temp.salary_market_classified',
    );
  }
}

/** Replace together so readers cannot observe half a new weekly slice. */
export function writeSalaryMarketSnapshots(
  database: DatabaseSync,
  snapshots: readonly SalaryMarketSnapshot[],
  observedAt = new Date(),
): void {
  database.exec(SALARY_MARKET_TABLE_SQL);
  database.exec(SALARY_SKILL_HISTORY_TABLE_SQL);
  database.exec('BEGIN IMMEDIATE');
  try {
    const prepared = accrueSalarySkillHistory(database, snapshots, observedAt);
    database.exec('DELETE FROM salary_market_snapshots');
    const insert = database.prepare('INSERT INTO salary_market_snapshots VALUES (?, ?)');
    for (const snapshot of prepared) insert.run(snapshot.role, JSON.stringify(snapshot));
    const index = prepared
      .map((snapshot) => ({
        role: snapshot.role,
        roleLabel: snapshot.roleLabel,
        profession: snapshot.profession,
        sampleSize: snapshot.sampleSize,
        updatedAt: snapshot.updatedAt,
        indexable: salarySnapshotIndexable(snapshot),
      }))
      .sort(
        (a, b) =>
          Number(b.indexable) - Number(a.indexable) ||
          b.sampleSize - a.sampleSize ||
          a.role.localeCompare(b.role, 'en'),
      )
      .slice(0, SALARY_MARKET_INDEX_LIMIT);
    database
      .prepare(
        `INSERT INTO salary_market_index VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`,
      )
      .run(JSON.stringify(index));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

/** Bounded primary-key lookup for public SSR. Missing/unpublished snapshots stay unavailable. */
export function readSalaryMarketSnapshot(
  database: DatabaseSync,
  role: string,
): SalaryMarketSnapshot | null {
  if (
    !database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'salary_market_snapshots'",
      )
      .get()
  )
    return null;
  const row = database
    .prepare('SELECT payload FROM salary_market_snapshots WHERE role = ?')
    .get(role) as { payload: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as SalaryMarketSnapshot;
  } catch {
    return null;
  }
}

/** Directory prepared by maintenance: at most SALARY_MARKET_INDEX_LIMIT entries, one key read. */
export function readSalaryMarketIndex(database: DatabaseSync): readonly SalaryMarketIndexEntry[] {
  if (
    !database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'salary_market_index'")
      .get()
  )
    return [];
  const row = database.prepare('SELECT payload FROM salary_market_index WHERE id = 1').get() as
    { payload: string } | undefined;
  if (!row) return [];
  try {
    return JSON.parse(row.payload) as SalaryMarketIndexEntry[];
  } catch {
    return [];
  }
}
