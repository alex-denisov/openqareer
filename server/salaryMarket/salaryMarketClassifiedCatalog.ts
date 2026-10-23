import type { DatabaseSync } from 'node:sqlite';
import {
  SALARY_MARKET_ROLE_LIMIT,
  type SalaryMarketGrade,
} from '../../shared/salaryMarketSnapshot';
import { classifySalaryMarketTitle } from './salaryMarketClassification';

interface SourceRow {
  readonly cluster_id: string;
  readonly title: string;
  readonly role_slug: string | null;
  readonly skills_json: string;
  readonly salary_json: string | null;
}
export interface ClassifiedSalaryRow {
  readonly cluster_id: string;
  readonly role: string;
  readonly role_label: string;
  readonly profession_kind: 'b267' | 'unclassified_title';
  readonly profession_id: string | null;
  readonly matched_alias: string | null;
  readonly grade: SalaryMarketGrade;
  readonly marker: string | null;
  readonly skills_json: string;
  readonly salary_json: string | null;
}

/** Maintenance-only classification: 500 public source rows in JS, the complete projection in SQLite. */
export function prepareClassifiedSalaryCatalog(database: DatabaseSync, now: Date): void {
  database.exec(`CREATE TEMP TABLE salary_market_classified (
    cluster_id TEXT PRIMARY KEY, role TEXT NOT NULL, role_label TEXT NOT NULL,
    profession_kind TEXT NOT NULL, profession_id TEXT, matched_alias TEXT,
    grade TEXT NOT NULL, marker TEXT, skills_json TEXT NOT NULL, salary_json TEXT
  ) WITHOUT ROWID;
  CREATE INDEX temp.salary_market_classified_role ON salary_market_classified(role, cluster_id)`);
  const read = database.prepare(`SELECT e.cluster_id, e.title, e.role_slug, e.skills_json,
    json_extract(c.cluster_json, '$.salary') AS salary_json FROM catalog_entries e
    LEFT JOIN vacancy_clusters c ON c.id = e.cluster_id
    WHERE e.cluster_id > ? AND e.status = 'active' AND e.published_ms >= ? AND e.published_ms <= ?
    ORDER BY e.cluster_id LIMIT 500`);
  const insert = database.prepare(
    'INSERT INTO salary_market_classified VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  let cursor = '';
  while (true) {
    const rows = read.all(
      cursor,
      now.getTime() - 90 * 86_400_000,
      now.getTime(),
    ) as unknown as SourceRow[];
    if (rows.length === 0) break;
    for (const row of rows) {
      const value = classifySalaryMarketTitle(row.title, row.role_slug);
      const known = value.profession.kind === 'b267' ? value.profession : null;
      insert.run(
        row.cluster_id,
        value.role,
        value.roleLabel,
        value.profession.kind,
        known?.roleId ?? null,
        known?.matchedAlias ?? null,
        value.grade.grade,
        value.grade.marker,
        row.skills_json,
        row.salary_json,
      );
    }
    cursor = rows[rows.length - 1]!.cluster_id;
  }
}

/** Canonical professions first, then sample size and slug; fallback titles never share an invented profession. */
export function selectClassifiedSalaryRoles(database: DatabaseSync): string[] {
  return (
    database
      .prepare(
        `SELECT role FROM salary_market_classified GROUP BY role
    ORDER BY (max(profession_kind) = 'b267') DESC, count(*) DESC, role ASC LIMIT ?`,
      )
      .all(SALARY_MARKET_ROLE_LIMIT) as { role: string }[]
  ).map((row) => row.role);
}

export function classifiedSalaryPage(
  database: DatabaseSync,
  roles: readonly string[],
  cursor: string,
): ClassifiedSalaryRow[] {
  return database
    .prepare(
      `SELECT * FROM salary_market_classified
    WHERE cluster_id > ? AND role IN (${roles.map(() => '?').join(',')})
    ORDER BY cluster_id LIMIT 500`,
    )
    .all(cursor, ...roles) as unknown as ClassifiedSalaryRow[];
}
