/**
 * B803: внутреннее хранилище зарплат. `salary_sources`, `salary_slices`, `salary_records` — источник
 * истины: срезы источников с датой и версией, прежние остаются. `salary_benchmarks` пересобирается из
 * последних срезов включённых источников, её читает веб.
 */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readCurrencyRates } from '../../currency/cbrRates';
import { ROLLUP_TABLES_SQL, writeRollups } from './benchmarkRollups';
import { PRICE_TABLE_SQL, pricesOf } from './priceIndex';
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
  UNIQUE (source, slice_date, version)
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
) STRICT;
${ROLLUP_TABLES_SQL};
${PRICE_TABLE_SQL}`;

const CURRENT_SQL = `SELECT r.row_json FROM salary_sources s
  JOIN salary_records r ON r.slice_id = (
    SELECT id FROM salary_slices WHERE source = s.name
    ORDER BY slice_date DESC, version DESC LIMIT 1)
  WHERE s.enabled = 1 AND NOT EXISTS (
    SELECT 1 FROM salary_source_exclusions x WHERE x.source = s.name AND x.country = r.country)`;

const placeKey = (row: SalaryBenchmark): string =>
  row.country ? `country:${row.country}` : `region:${row.region}`;

const recordKey = (row: SalaryBenchmark): string => `${row.sourceName}|${row.id}`;

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

function readable({ row_json }: { readonly row_json: string }): SalaryBenchmark[] {
  try {
    const parsed = salaryBenchmarkSchema.safeParse(JSON.parse(row_json));
    return parsed.success ? [parsed.data] : [];
  } catch {
    return [];
  }
}

interface Published {
  /** Строк в подборе из срезов. */
  readonly published: number;
  /** Записей, которые не читаются нынешней схемой: пропущены, остальные источники живут. */
  readonly unreadable: number;
}

/** Пересборка подбора из последних срезов. Строки источника без единого среза остаются. */
function publish(database: DatabaseSync): Published {
  const texts = database.prepare(CURRENT_SQL).all() as { row_json: string }[];
  const records = texts.flatMap(readable);
  const rows = records.flatMap(plausible).map(pricesOf(database));
  database.exec(`DELETE FROM salary_benchmarks WHERE json_extract(row_json, '$.sourceName') IN (
    SELECT s.name FROM salary_sources s
    WHERE s.enabled = 0 OR EXISTS (SELECT 1 FROM salary_slices WHERE source = s.name))`);
  const insert = database.prepare(
    'INSERT INTO salary_benchmarks (id, place, row_json) VALUES (?, ?, ?)',
  );
  for (const row of rows) insert.run(recordKey(row), placeKey(row), JSON.stringify(row));
  writeRollups(database, rows, { placeKey, recordKey }, readCurrencyRates(database), new Date());
  database.exec(
    `INSERT INTO salary_benchmarks_version VALUES (1, 1)
      ON CONFLICT (id) DO UPDATE SET version = version + 1`,
  );
  return { published: rows.length, unreadable: texts.length - records.length };
}

/** Срезов источника на пересчёт; более старые уходят. */
const KEPT_SLICES = 4;

function dropOldSlices(database: DatabaseSync, source: string): void {
  const old = `SELECT id FROM salary_slices WHERE source = ?
    ORDER BY slice_date DESC, version DESC LIMIT -1 OFFSET ${KEPT_SLICES}`;
  database.prepare(`DELETE FROM salary_records WHERE slice_id IN (${old})`).run(source);
  database.prepare(`DELETE FROM salary_slices WHERE id IN (${old})`).run(source);
}

function sourceBefore(database: DatabaseSync, { name, kind }: SalarySlice['source']) {
  const before = database
    .prepare('SELECT kind, enabled FROM salary_sources WHERE name = ?')
    .get(name) as { kind: string; enabled: number } | undefined;
  if (before && before.kind !== kind) throw new Error('another kind of the source');
  return before;
}

/** Срез повторяет последнюю версию своей даты. */
function isRepeated(database: DatabaseSync, slice: SalarySlice): boolean {
  const last = database
    .prepare(
      `SELECT digest FROM salary_slices WHERE source = ? AND slice_date = ?
        ORDER BY version DESC LIMIT 1`,
    )
    .get(slice.source.name, slice.sliceDate) as { digest: string } | undefined;
  return last?.digest === digestOf(slice);
}

/** Дата старше всех сохранённых при полном запасе: срез сразу выпал бы. */
function isTooOld(database: DatabaseSync, { source, sliceDate }: SalarySlice): boolean {
  const kept = database
    .prepare(
      'SELECT count(*) AS count, min(slice_date) AS oldest FROM salary_slices WHERE source = ?',
    )
    .get(source.name) as { count: number; oldest: string | null };
  return kept.count >= KEPT_SLICES && kept.oldest !== null && sliceDate < kept.oldest;
}

export interface WrittenSlice extends Partial<Published> {
  readonly written: number;
}

/**
 * Пишет срез одного источника; неверный срез не меняет ничего, чужие источники не трогаются.
 * Тот же срез второй раз не пишется. Включить выключенный источник импорт не может.
 */
export function writeSalarySlice(database: DatabaseSync, input: unknown): WrittenSlice {
  const slice = salarySliceSchema.parse(input);
  const { source, sliceDate, benchmarks } = slice;
  database.exec(TABLES_SQL);
  return inTransaction(database, () => {
    const before = sourceBefore(database, source);
    database
      .prepare(
        `INSERT INTO salary_sources VALUES (?, ?, ?)
          ON CONFLICT (name) DO UPDATE SET enabled = min(enabled, excluded.enabled)`,
      )
      .run(source.name, source.kind, Number(source.enabled));
    const skipped = isRepeated(database, slice) || isTooOld(database, slice);
    if (!skipped) {
      const { lastInsertRowid } = database
        .prepare(
          `INSERT INTO salary_slices (source, slice_date, version, digest, loaded_at)
            SELECT ?, ?, coalesce(max(version), 0) + 1, ?, ?
            FROM salary_slices WHERE source = ? AND slice_date = ?`,
        )
        .run(
          source.name,
          sliceDate,
          digestOf(slice),
          new Date().toISOString(),
          source.name,
          sliceDate,
        );
      insertRecords(database, Number(lastInsertRowid), benchmarks);
      dropOldSlices(database, source.name);
    }
    const switchedOff = before?.enabled === 1 && !source.enabled;
    if (skipped && !switchedOff) return { written: 0 };
    return { written: skipped ? 0 : benchmarks.length, ...publish(database) };
  });
}

/** Пересборка без нового среза: изменились цены, курсы или правила. */
export function rebuildSalaryBenchmarks(database: DatabaseSync): Published {
  database.exec(TABLES_SQL);
  return inTransaction(database, () => publish(database));
}

/**
 * Что записал бы `writeSalarySlice`: те же проверки, а запись и пересборка — в базе в памяти. Саму
 * базу не меняет и таблиц не создаёт.
 */
export function previewSalarySlice(database: DatabaseSync, input: unknown): WrittenSlice {
  const slice = salarySliceSchema.parse(input);
  const stored = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'salary_slices'")
    .get();
  if (stored) {
    sourceBefore(database, slice.source);
    if (isRepeated(database, slice) || isTooOld(database, slice)) return { written: 0 };
  }
  const memory = new DatabaseSync(':memory:');
  try {
    return writeSalarySlice(memory, input);
  } finally {
    memory.close();
  }
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
