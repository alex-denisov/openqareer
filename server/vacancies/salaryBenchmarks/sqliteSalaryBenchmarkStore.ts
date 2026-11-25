/** B803: таблица `salary_benchmarks`. Пишет процесс обслуживания из файла рядом с базой, веб читает. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  salaryBenchmarkSchema,
  salaryBenchmarksSchema,
  type SalaryBenchmark,
} from './salaryBenchmark';

export const SALARY_BENCHMARKS_FILE = 'salary-benchmarks.json';

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS salary_benchmarks (
  id TEXT PRIMARY KEY,
  place TEXT NOT NULL,
  row_json TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS salary_benchmarks_place ON salary_benchmarks(place)`;

const placeKey = (row: SalaryBenchmark): string =>
  row.country ? `country:${row.country}` : `region:${row.region}`;

/** Заменяет таблицу целиком; неверный файл не меняет ничего. */
export function writeSalaryBenchmarks(database: DatabaseSync, input: unknown): number {
  const rows = salaryBenchmarksSchema.parse(input);
  database.exec(TABLE_SQL);
  const insert = database.prepare(
    'INSERT INTO salary_benchmarks (id, place, row_json) VALUES (?, ?, ?)',
  );
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec('DELETE FROM salary_benchmarks');
    for (const row of rows) insert.run(row.id, placeKey(row), JSON.stringify(row));
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
  return rows.length;
}

interface LoadLog {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

/** Нет файла — таблица остаётся как была. */
export function loadSalaryBenchmarksFile(
  database: DatabaseSync,
  databasePath: string,
  log: LoadLog,
): void {
  try {
    const text = readFileSync(join(dirname(databasePath), SALARY_BENCHMARKS_FILE), 'utf8');
    log.info(
      { rows: writeSalaryBenchmarks(database, JSON.parse(text)) },
      'salary-benchmarks-loaded',
    );
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    log.error(
      {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        detail: error instanceof Error ? error.message.slice(0, 500) : undefined,
      },
      'salary-benchmarks-load-failed',
    );
  }
}

/** Цифры страны вместе с цифрами её региона; таблицы ещё нет — пусто. */
export function readSalaryBenchmarks(
  database: DatabaseSync,
  place: { readonly country?: string; readonly region?: string },
): SalaryBenchmark[] {
  const exists = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'salary_benchmarks'")
    .get();
  if (!exists) return [];
  const rows = database
    .prepare('SELECT row_json FROM salary_benchmarks WHERE place IN (?, ?) ORDER BY id')
    .all(`country:${place.country ?? ''}`, `region:${place.region ?? ''}`) as {
    row_json: string;
  }[];
  return rows.map((row) => salaryBenchmarkSchema.parse(JSON.parse(row.row_json)));
}
