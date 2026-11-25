/**
 * B803: внутреннее хранилище зарплат. `salary_sources`, `salary_slices`, `salary_records` — источник
 * истины: срезы источников с датой и версией, прежние остаются. `salary_benchmarks` пересобирается из
 * последних срезов включённых источников, её читает веб.
 */
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  plausible,
  salaryBenchmarkSchema,
  salarySliceSchema,
  type SalaryBenchmark,
  type SalarySlice,
} from './salaryBenchmark';

const TABLES_SQL = `CREATE TABLE IF NOT EXISTS salary_sources (
  name TEXT PRIMARY KEY, kind TEXT NOT NULL, enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
) STRICT;
CREATE TABLE IF NOT EXISTS salary_source_exclusions (
  source TEXT NOT NULL REFERENCES salary_sources(name), country TEXT NOT NULL,
  PRIMARY KEY (source, country)
) STRICT, WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS salary_slices (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL REFERENCES salary_sources(name),
  slice_date TEXT NOT NULL,
  version INTEGER NOT NULL,
  digest TEXT NOT NULL,
  loaded_at TEXT NOT NULL,
  UNIQUE (source, slice_date, version),
  UNIQUE (source, digest)
) STRICT;
CREATE TABLE IF NOT EXISTS salary_records (
  slice_id INTEGER NOT NULL REFERENCES salary_slices(id),
  id TEXT NOT NULL,
  function_code TEXT, level_rank INTEGER,
  country TEXT, region TEXT, city TEXT,
  currency TEXT NOT NULL, period TEXT NOT NULL, tax TEXT NOT NULL,
  low REAL, median REAL, high REAL,
  sample_size INTEGER, year INTEGER NOT NULL, read_on TEXT NOT NULL,
  row_json TEXT NOT NULL,
  PRIMARY KEY (slice_id, id)
) STRICT, WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS salary_benchmarks (
  id TEXT PRIMARY KEY,
  place TEXT NOT NULL,
  row_json TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS salary_benchmarks_place ON salary_benchmarks(place);
CREATE TABLE IF NOT EXISTS salary_benchmarks_version (
  id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL
) STRICT`;

const CURRENT_SQL = `SELECT r.row_json FROM salary_sources s
  JOIN salary_records r ON r.slice_id = (
    SELECT id FROM salary_slices WHERE source = s.name
    ORDER BY slice_date DESC, version DESC LIMIT 1)
  WHERE s.enabled = 1 AND NOT EXISTS (
    SELECT 1 FROM salary_source_exclusions x WHERE x.source = s.name AND x.country = r.country)`;

const placeKey = (row: SalaryBenchmark): string =>
  row.country ? `country:${row.country}` : `region:${row.region}`;

function inTransaction<Result>(database: DatabaseSync, work: () => Result): Result {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    database.exec('COMMIT');
    return result;
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function digestOf({ sliceDate, benchmarks }: SalarySlice): string {
  const rows = benchmarks.map((row) => JSON.stringify(row)).sort();
  return createHash('sha256')
    .update(JSON.stringify([sliceDate, rows]))
    .digest('hex');
}

function insertRecords(database: DatabaseSync, sliceId: number, rows: readonly SalaryBenchmark[]) {
  const insert = database.prepare(
    'INSERT INTO salary_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const row of rows)
    insert.run(
      sliceId,
      row.id,
      row.functionCode,
      row.levelRank,
      row.country,
      row.region,
      row.city,
      row.currency,
      row.period,
      row.tax,
      row.low,
      row.median,
      row.high,
      row.sampleSize,
      row.year,
      row.readOn,
      JSON.stringify(row),
    );
}

/** Пересборка таблицы подбора из последних срезов; возвращает число строк. */
function publish(database: DatabaseSync): number {
  const texts = database.prepare(CURRENT_SQL).all() as { row_json: string }[];
  const rows = texts.flatMap(({ row_json }) =>
    plausible(salaryBenchmarkSchema.parse(JSON.parse(row_json))),
  );
  database.exec('DELETE FROM salary_benchmarks');
  const insert = database.prepare(
    'INSERT INTO salary_benchmarks (id, place, row_json) VALUES (?, ?, ?)',
  );
  for (const row of rows)
    insert.run(`${row.sourceName}|${row.id}`, placeKey(row), JSON.stringify(row));
  database.exec(
    `INSERT INTO salary_benchmarks_version VALUES (1, 1)
      ON CONFLICT (id) DO UPDATE SET version = version + 1`,
  );
  return rows.length;
}

/**
 * Пишет срез одного источника; неверный срез не меняет ничего, чужие источники не трогаются.
 * Тот же срез второй раз не пишется. Включить выключенный источник импорт не может.
 */
export function writeSalarySlice(
  database: DatabaseSync,
  input: unknown,
): { readonly written: number } {
  const slice = salarySliceSchema.parse(input);
  const { source, sliceDate, benchmarks } = slice;
  const digest = digestOf(slice);
  database.exec(TABLES_SQL);
  return inTransaction(database, () => {
    const known = database.prepare('SELECT kind, enabled FROM salary_sources WHERE name = ?');
    const before = known.get(source.name) as { kind: string; enabled: number } | undefined;
    if (before && before.kind !== source.kind) throw new Error('another kind of the source');
    database
      .prepare(
        `INSERT INTO salary_sources VALUES (?, ?, ?)
          ON CONFLICT (name) DO UPDATE SET enabled = min(enabled, excluded.enabled)`,
      )
      .run(source.name, source.kind, Number(source.enabled));
    const repeated = database
      .prepare('SELECT 1 FROM salary_slices WHERE source = ? AND digest = ?')
      .get(source.name, digest);
    if (!repeated) {
      const { lastInsertRowid } = database
        .prepare(
          `INSERT INTO salary_slices (source, slice_date, version, digest, loaded_at)
            SELECT ?, ?, coalesce(max(version), 0) + 1, ?, ?
            FROM salary_slices WHERE source = ? AND slice_date = ?`,
        )
        .run(source.name, sliceDate, digest, new Date().toISOString(), source.name, sliceDate);
      insertRecords(database, Number(lastInsertRowid), benchmarks);
    }
    const switchedOff = before?.enabled === 1 && !source.enabled;
    if (!repeated || switchedOff) publish(database);
    return { written: repeated ? 0 : benchmarks.length };
  });
}

/** Что записал бы `writeSalarySlice`; базу не меняет и таблиц не создаёт. */
export function previewSalarySlice(
  database: DatabaseSync,
  input: unknown,
): { readonly written: number } {
  const slice = salarySliceSchema.parse(input);
  const table = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'salary_slices'")
    .get();
  const repeated =
    table &&
    database
      .prepare('SELECT 1 FROM salary_slices WHERE source = ? AND digest = ?')
      .get(slice.source.name, digestOf(slice));
  return { written: repeated ? 0 : slice.benchmarks.length };
}

/** Страна источника, чьи цифры расходятся с остальными, не участвует в подборе; срезы остаются. */
export function setSalaryCountryExcluded(
  database: DatabaseSync,
  source: string,
  country: string,
  excluded: boolean,
): void {
  if (!/^[A-Z]{2}$/u.test(country)) throw new Error('country code is expected');
  database.exec(TABLES_SQL);
  inTransaction(database, () => {
    if (!database.prepare('SELECT 1 FROM salary_sources WHERE name = ?').get(source))
      throw new Error('unknown salary source');
    database
      .prepare(
        excluded
          ? 'INSERT OR IGNORE INTO salary_source_exclusions VALUES (?, ?)'
          : 'DELETE FROM salary_source_exclusions WHERE source = ? AND country = ?',
      )
      .run(source, country);
    publish(database);
  });
}

/** Выключенный источник уходит из подбора сразу, его срезы остаются. */
export function setSalarySourceEnabled(
  database: DatabaseSync,
  name: string,
  enabled: boolean,
): void {
  database.exec(TABLES_SQL);
  inTransaction(database, () => {
    const { changes } = database
      .prepare('UPDATE salary_sources SET enabled = ? WHERE name = ?')
      .run(Number(enabled), name);
    if (changes === 0) throw new Error('unknown salary source');
    publish(database);
  });
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

/** Таблицы ещё нет — пусто. Разобранные строки места живут до следующей пересборки. */
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
