import type { DatabaseSync } from 'node:sqlite';
import type { SalaryMarketSnapshot, SalaryObservation } from '../../shared/salaryMarketSnapshot';

export const SALARY_MARKET_TABLE_SQL = `CREATE TABLE IF NOT EXISTS salary_market_snapshots (
  role TEXT PRIMARY KEY,
  payload TEXT NOT NULL
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

interface CatalogRow {
  readonly cluster_id: string;
  readonly role_slug: string;
  readonly role_label: string | null;
  readonly skills_json: string;
}

function skillsOf(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed)
      ? [
          ...new Set(
            parsed
              .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
              .map((item) => item.trim()),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}

function prepareSkillCounts(database: DatabaseSync) {
  // Keep the potentially large skill vocabulary in SQLite, not an unbounded JS map.
  database.exec(`CREATE TEMP TABLE IF NOT EXISTS salary_market_skill_counts (
    role TEXT NOT NULL, skill TEXT NOT NULL, count INTEGER NOT NULL,
    PRIMARY KEY (role, skill)
  ) WITHOUT ROWID`);
  database.exec('DELETE FROM salary_market_skill_counts');
  const addSkill = database.prepare(`INSERT INTO salary_market_skill_counts VALUES (?, ?, 1)
    ON CONFLICT(role, skill) DO UPDATE SET count = count + 1`);
  const topSkills = database.prepare(`SELECT skill AS name, count FROM salary_market_skill_counts
    WHERE role = ? ORDER BY count DESC, skill ASC LIMIT 15`);
  return { addSkill, topSkills };
}

/** Maintenance only. Keyset chunks bound JSON materialization; the HTTP reader never scans. */
function buildSalaryMarketSnapshots(database: DatabaseSync, now: Date): SalaryMarketSnapshot[] {
  const statement =
    database.prepare(`SELECT cluster_id, role_slug, role_label, skills_json FROM catalog_entries
    WHERE cluster_id > ? AND status = 'active' AND role_slug IS NOT NULL
      AND published_ms >= ? AND published_ms <= ? ORDER BY cluster_id LIMIT 500`);
  const { addSkill, topSkills } = prepareSkillCounts(database);
  const groups = new Map<string, { label: string; count: number }>();
  let cursor = '';
  while (true) {
    const rows = statement.all(
      cursor,
      now.getTime() - 90 * 86_400_000,
      now.getTime(),
    ) as unknown as CatalogRow[];
    if (rows.length === 0) break;
    for (const row of rows) {
      const group = groups.get(row.role_slug) ?? {
        label: row.role_label ?? row.role_slug,
        count: 0,
      };
      group.count += 1;
      for (const name of skillsOf(row.skills_json)) addSkill.run(row.role_slug, name);
      groups.set(row.role_slug, group);
    }
    cursor = rows[rows.length - 1]!.cluster_id;
  }
  return [...groups.entries()].map(([role, group]) => ({
    role,
    roleLabel: group.label,
    updatedAt: now.toISOString(),
    windowDays: 90,
    sampleSize: group.count,
    skills: (topSkills.all(role) as { name: string; count: number }[]).map(({ name, count }) => ({
      name,
      count,
      frequency: Math.round((count / group.count) * 10000) / 100,
    })),
    salary: { status: 'unavailable', reason: 'missing_explicit_salary_period' },
    quarterlyTrend: 'unavailable',
    grades: 'unavailable',
    source: 'deduplicated_public_catalog',
  }));
}

/** Always release the maintenance-only scratch vocabulary, including after failed writes. */
export function computeSalaryMarketSnapshots(
  database: DatabaseSync,
  now: Date,
): SalaryMarketSnapshot[] {
  try {
    return buildSalaryMarketSnapshots(database, now);
  } finally {
    database.exec('DROP TABLE IF EXISTS temp.salary_market_skill_counts');
  }
}

/** Replace together so readers cannot observe half a new weekly slice. */
export function writeSalaryMarketSnapshots(
  database: DatabaseSync,
  snapshots: readonly SalaryMarketSnapshot[],
): void {
  database.exec(SALARY_MARKET_TABLE_SQL);
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec('DELETE FROM salary_market_snapshots');
    const insert = database.prepare('INSERT INTO salary_market_snapshots VALUES (?, ?)');
    for (const snapshot of snapshots) insert.run(snapshot.role, JSON.stringify(snapshot));
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
