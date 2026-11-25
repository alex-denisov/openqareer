/** B803: таблица `salary_benchmarks`. Пишет процесс обслуживания из файла рядом с базой, веб читает. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { readCurrencyRates } from '../../currency/cbrRates';
import { ROLLUP_TABLES_SQL, writeRollups } from './benchmarkRollups';
import {
  enabledBenchmarks,
  salaryBenchmarkSchema,
  salaryBenchmarksFileSchema,
  type SalaryBenchmark,
} from './salaryBenchmark';

export const SALARY_BENCHMARKS_FILE = 'salary-benchmarks.json';

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS salary_benchmarks (
  id TEXT PRIMARY KEY,
  place TEXT NOT NULL,
  row_json TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS salary_benchmarks_place ON salary_benchmarks(place);
CREATE TABLE IF NOT EXISTS salary_benchmarks_version (
  id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL
) STRICT`;

const placeKey = (row: SalaryBenchmark): string =>
  row.country ? `country:${row.country}` : `region:${row.region}`;

/** Заменяет таблицу целиком; неверный файл не меняет ничего. */
export function writeSalaryBenchmarks(database: DatabaseSync, input: unknown): number {
  const rows = enabledBenchmarks(salaryBenchmarksFileSchema.parse(input));
  database.exec(TABLE_SQL);
  database.exec(ROLLUP_TABLES_SQL);
  const insert = database.prepare(
    'INSERT INTO salary_benchmarks (id, place, row_json) VALUES (?, ?, ?)',
  );
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec('DELETE FROM salary_benchmarks');
    for (const row of rows) insert.run(row.id, placeKey(row), JSON.stringify(row));
    writeRollups(database, rows, placeKey, readCurrencyRates(database), new Date());
    database.exec(
      `INSERT INTO salary_benchmarks_version VALUES (1, 1)
        ON CONFLICT (id) DO UPDATE SET version = version + 1`,
    );
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

export type SalaryBenchmarkReader = (place: {
  readonly country?: string;
  readonly region?: string;
}) => readonly SalaryBenchmark[];

function prepareReader(database: DatabaseSync) {
  return {
    version: database.prepare('SELECT version FROM salary_benchmarks_version'),
    rows: database.prepare('SELECT row_json FROM salary_benchmarks WHERE place = ? ORDER BY id'),
  };
}

/** Таблицы ещё нет — пусто. Разобранные строки места живут до следующей загрузки файла. */
export function createSalaryBenchmarkReader(database: DatabaseSync): SalaryBenchmarkReader {
  let statements: ReturnType<typeof prepareReader> | undefined;
  let cache = { version: -1, places: new Map<string, readonly SalaryBenchmark[]>() };
  const prepared = () => {
    try {
      statements ??= prepareReader(database);
    } catch (error: unknown) {
      if (!(error instanceof Error && error.message.includes('no such table'))) throw error;
    }
    return statements;
  };
  return ({ country, region }) => {
    const ready = prepared();
    const current = ready?.version.get() as { version: number } | undefined;
    if (!ready || !current) return [];
    if (current.version !== cache.version) cache = { version: current.version, places: new Map() };
    const read = (place: string): readonly SalaryBenchmark[] => {
      const known = cache.places.get(place);
      if (known) return known;
      const rows = (ready.rows.all(place) as { row_json: string }[]).map((row) =>
        salaryBenchmarkSchema.parse(JSON.parse(row.row_json)),
      );
      cache.places.set(place, rows);
      return rows;
    };
    return [
      ...(country ? read(`country:${country}`) : []),
      ...(region ? read(`region:${region}`) : []),
    ];
  };
}
