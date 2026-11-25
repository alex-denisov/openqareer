/** B803: таблицы открытой статистики и заработок страны: прямой или с поправкой на доход региона. */
import type { DatabaseSync } from 'node:sqlite';
import {
  OPEN_STATISTICS_SOURCES,
  type CountryIncome,
  type OccupationEarning,
} from './openStatistics';

const TABLES_SQL = `CREATE TABLE IF NOT EXISTS occupation_earnings (
  country TEXT NOT NULL, isco TEXT NOT NULL, year INTEGER NOT NULL, monthly_usd REAL NOT NULL,
  PRIMARY KEY (country, isco)
) STRICT;
CREATE TABLE IF NOT EXISTS country_income (
  country TEXT PRIMARY KEY, year INTEGER NOT NULL, per_capita_usd REAL NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS open_statistics_sources (
  table_name TEXT PRIMARY KEY, name TEXT NOT NULL, license TEXT NOT NULL,
  attribution TEXT NOT NULL, url TEXT NOT NULL, loaded_at TEXT NOT NULL
) STRICT`;

/** Меньше этого — ответ источника обрезан: прежние таблицы остаются. */
const MIN_COUNTRIES = 50;

export function writeOpenStatistics(
  database: DatabaseSync,
  earnings: readonly OccupationEarning[],
  incomes: readonly CountryIncome[],
): { readonly earnings: number; readonly countries: number } {
  const iso2 = new Map(incomes.map((row) => [row.iso3, row.iso2]));
  const known = earnings.flatMap((row) => {
    const country = iso2.get(row.iso3);
    return country ? [{ ...row, country }] : [];
  });
  const countries = new Set(known.map(({ country }) => country)).size;
  if (countries < MIN_COUNTRIES || incomes.length < MIN_COUNTRIES)
    throw new Error('open statistics answer is incomplete');
  database.exec(TABLES_SQL);
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec('DELETE FROM occupation_earnings; DELETE FROM country_income');
    const earning = database.prepare('INSERT INTO occupation_earnings VALUES (?, ?, ?, ?)');
    for (const row of known) earning.run(row.country, row.isco, row.year, row.monthlyUsd);
    const income = database.prepare('INSERT INTO country_income VALUES (?, ?, ?)');
    for (const row of incomes) income.run(row.iso2, row.year, row.perCapitaUsd);
    const source = database.prepare(
      'INSERT OR REPLACE INTO open_statistics_sources VALUES (?, ?, ?, ?, ?, ?)',
    );
    const loadedAt = new Date().toISOString();
    for (const row of OPEN_STATISTICS_SOURCES)
      source.run(row.table, row.name, row.license, row.attribution, row.url, loadedAt);
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
  return { earnings: known.length, countries };
}

/** Когда данные загружены в последний раз, мс. */
export function openStatisticsLoadedAt(database: DatabaseSync): number | undefined {
  if (!hasTables(database)) return undefined;
  const row = database
    .prepare('SELECT MIN(loaded_at) AS at FROM open_statistics_sources')
    .get() as {
    at: string | null;
  };
  return row.at ? Date.parse(row.at) : undefined;
}

export interface CountryEarning {
  readonly monthlyUsd: number;
  readonly year: number;
  /** `adjusted`: своих данных у страны нет, взята доля дохода стран-соседей. */
  readonly basis: 'direct' | 'adjusted';
}

const MIN_DONORS = 2;
/** Отношение заработка к доходу у соседей расходится сильнее — поправка ничего не значит. */
const MAX_DONOR_SPREAD = 2.5;
const MONTHS = 12;

function hasTables(database: DatabaseSync): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'occupation_earnings'")
      .get(),
  );
}

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function adjusted(
  database: DatabaseSync,
  country: string,
  isco: string,
  neighbours: readonly string[],
): CountryEarning | undefined {
  const income = database
    .prepare('SELECT per_capita_usd AS value, year FROM country_income WHERE country = ?')
    .get(country) as { value: number; year: number } | undefined;
  if (!income) return undefined;
  const donor = database.prepare(
    `SELECT e.monthly_usd * ${MONTHS} / i.per_capita_usd AS share FROM occupation_earnings e
      JOIN country_income i ON i.country = e.country WHERE e.country = ? AND e.isco = ?`,
  );
  const shares = neighbours
    .flatMap((code) => {
      const row = code === country ? undefined : (donor.get(code, isco) as { share: number });
      return row ? [row.share] : [];
    })
    .sort((a, b) => a - b);
  if (shares.length < MIN_DONORS || shares.at(-1)! > shares[0]! * MAX_DONOR_SPREAD)
    return undefined;
  return {
    monthlyUsd: (median(shares) * income.value) / MONTHS,
    year: income.year,
    basis: 'adjusted',
  };
}

/** Среднемесячный заработок группы занятий; нет своих данных и соседей — нет ответа. */
export function countryEarning(
  database: DatabaseSync,
  country: string,
  isco: string,
  neighbours: readonly string[],
): CountryEarning | undefined {
  if (!hasTables(database)) return undefined;
  const direct = database
    .prepare(
      'SELECT monthly_usd AS monthlyUsd, year FROM occupation_earnings WHERE country = ? AND isco = ?',
    )
    .get(country, isco) as { monthlyUsd: number; year: number } | undefined;
  return direct
    ? { monthlyUsd: direct.monthlyUsd, year: direct.year, basis: 'direct' }
    : adjusted(database, country, isco, neighbours);
}
