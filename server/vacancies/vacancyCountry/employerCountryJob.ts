/**
 * B803: страна работодателя — по каждой пятой порции вакансий раз в сутки: доля страны работодателя от
 * этого не меняется, а чтение впятеро короче.
 */
import type { DatabaseSync } from 'node:sqlite';
import { schedulePersistedJob } from '../../maintenance/persistedJobSchedule';
import { marketSalaryCountry } from '../marketSalary/marketSalaryCountry';
import { writeCityTable } from './bundledCities';
import { EMPLOYER_TABLE_SQL } from './sqliteCities';
import { dominantEmployerCountry, employerKey } from './vacancyCountryHint';

interface Log {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}
export interface EmployerPassOptions {
  readonly sliceRows?: number;
  readonly every?: number;
  readonly pause?: () => Promise<void>;
}

const SLICE_ROWS = 200;
const EVERY = 5;
const PAUSE_MS = 50;
const FIRST_RUN_MS = 20 * 60_000;
const INTERVAL_MS = 24 * 60 * 60_000;

const SLICE_SQL = `SELECT json_extract(cluster_json, '$.company') AS company,
    json_extract(cluster_json, '$.location') AS location
  FROM vacancy_cluster_input WHERE rowid > ? AND rowid <= ?`;

export async function computeEmployerCountries(
  database: DatabaseSync,
  options: EmployerPassOptions = {},
): Promise<Map<string, string>> {
  const { sliceRows = SLICE_ROWS, every = EVERY } = options;
  const pause = options.pause ?? (() => new Promise<void>((done) => setTimeout(done, PAUSE_MS)));
  const { last } = database
    .prepare('SELECT coalesce(max(rowid), 0) AS last FROM vacancy_cluster_input')
    .get() as { last: number };
  const slice = database.prepare(SLICE_SQL);
  const counts = new Map<string, Map<string, number>>();
  for (let from = 0; from < last; from += sliceRows * every) {
    if (from > 0) await pause();
    const rows = slice.all(from, from + sliceRows) as {
      company: string | null;
      location: string | null;
    }[];
    for (const { company, location } of rows) {
      const country = company ? marketSalaryCountry(location) : undefined;
      if (!company || !country) continue;
      const key = employerKey(company);
      const known = counts.get(key) ?? new Map<string, number>();
      known.set(country, (known.get(country) ?? 0) + 1);
      counts.set(key, known);
    }
  }
  return new Map(
    [...counts].flatMap(([key, known]) => {
      const country = dominantEmployerCountry(known);
      return country ? [[key, country] as const] : [];
    }),
  );
}

export function writeEmployerCountries(
  database: DatabaseSync,
  countries: ReadonlyMap<string, string>,
): void {
  database.exec(EMPLOYER_TABLE_SQL);
  const insert = database.prepare('INSERT INTO employer_countries VALUES (?, ?)');
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec('DELETE FROM employer_countries');
    for (const [employer, country] of countries) insert.run(employer, country);
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function scheduleEmployerCountryJob(database: DatabaseSync, log: Log): () => void {
  const run = async (): Promise<boolean> => {
    const started = Date.now();
    try {
      const cities = writeCityTable(database);
      const countries = await computeEmployerCountries(database);
      writeEmployerCountries(database, countries);
      log.info(
        { ms: Date.now() - started, employers: countries.size, cities },
        'employer-countries-written',
      );
      return true;
    } catch (error: unknown) {
      log.error(
        {
          errorName: error instanceof Error ? error.name : 'UnknownError',
          ms: Date.now() - started,
        },
        'employer-countries-failed',
      );
      return false;
    }
  };
  return schedulePersistedJob(database, log, {
    job: 'employer-countries',
    firstRunMs: FIRST_RUN_MS,
    intervalMs: INTERVAL_MS,
    run,
  });
}
