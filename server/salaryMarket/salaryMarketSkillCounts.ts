import type { DatabaseSync } from 'node:sqlite';
import type { SalaryMarketSnapshot } from '../../shared/salaryMarketSnapshot';

export function salarySkillsOf(json: string): string[] {
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

/** Skill vocabulary lives in SQLite. JS only materializes one row's skills and the published top15. */
export function prepareSalarySkillCounts(database: DatabaseSync) {
  database.exec(`CREATE TEMP TABLE IF NOT EXISTS salary_market_skill_counts (
    role TEXT NOT NULL, skill TEXT NOT NULL, count INTEGER NOT NULL,
    PRIMARY KEY (role, skill)
  ) WITHOUT ROWID`);
  database.exec('DELETE FROM salary_market_skill_counts');
  const insert = database.prepare(`INSERT INTO salary_market_skill_counts VALUES (?, ?, 1)
    ON CONFLICT(role, skill) DO UPDATE SET count = count + 1`);
  const query = database.prepare(`SELECT skill AS name, count FROM salary_market_skill_counts
    WHERE role = ? ORDER BY count DESC, skill ASC LIMIT 15`);
  return {
    add(key: string, skills: readonly string[]) {
      for (const name of skills) insert.run(key, name);
    },
    read(key: string, denominator: number): SalaryMarketSnapshot['skills'] {
      return (query.all(key) as { name: string; count: number }[]).map(({ name, count }) => ({
        name,
        count,
        frequency: Math.round((count / denominator) * 10000) / 100,
      }));
    },
  };
}
