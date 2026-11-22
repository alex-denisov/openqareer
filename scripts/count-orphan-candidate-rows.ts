/**
 * B739: сколько строк осталось от уже удалённых кандидатов. Только чтение: база открывается
 * с readOnly, наружу выходят имена таблиц и числа, без значений.
 *
 * Сирота — строка, чей `candidate_id` больше не встречается в `candidates`. Для
 * `legal_consents` (хранится по политике B195) отдельно считается, у скольких записей
 * удалённого пользователя не стоит дата прекращения договора.
 *
 *   npx tsx scripts/count-orphan-candidate-rows.ts /path/to/openqareer.sqlite
 */
import { DatabaseSync } from 'node:sqlite';

const SKIP = /^sqlite_|_fts_(config|content|data|docsize|idx)$/;

type Count = { total: number };

function count(database: DatabaseSync, sql: string): number {
  return Number((database.prepare(sql).get() as Count).total);
}

function candidateTables(database: DatabaseSync): string[] {
  const names = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>;
  return names
    .map(({ name }) => name)
    .filter((name) => name !== 'candidates' && !SKIP.test(name))
    .filter((name) =>
      (database.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>).some(
        (column) => column.name === 'candidate_id',
      ),
    )
    .sort();
}

function countOrphans(database: DatabaseSync) {
  const tables = candidateTables(database);
  const orphanRowsByTable = Object.fromEntries(
    tables
      .map(
        (table) =>
          [
            table,
            count(
              database,
              `SELECT COUNT(*) AS total FROM "${table}"
           WHERE candidate_id IS NOT NULL AND candidate_id NOT IN (SELECT id FROM candidates)`,
            ),
          ] as const,
      )
      .filter(([, total]) => total > 0),
  );
  const union = tables.map((table) => `SELECT candidate_id FROM "${table}"`).join(' UNION ALL ');
  return {
    candidateTables: tables.length,
    deletedCandidatesWithOrphans: count(
      database,
      `SELECT COUNT(DISTINCT candidate_id) AS total FROM (${union})
       WHERE candidate_id NOT IN (SELECT id FROM candidates)`,
    ),
    orphanRowsByTable,
    orphanRowsTotal: Object.values(orphanRowsByTable).reduce((sum, total) => sum + total, 0),
    legalConsentsWithoutContractEnd: count(
      database,
      `SELECT COUNT(*) AS total FROM legal_consents
       WHERE user_id NOT IN (SELECT id FROM users) AND contract_ended_at IS NULL`,
    ),
  };
}

function main(databasePath: string | undefined): void {
  if (!databasePath) throw new Error('usage: count-orphan-candidate-rows.ts <database path>');
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 20000;');
    process.stdout.write(`${JSON.stringify(countOrphans(database), null, 2)}\n`);
  } finally {
    database.close();
  }
}

main(process.argv[2]);
