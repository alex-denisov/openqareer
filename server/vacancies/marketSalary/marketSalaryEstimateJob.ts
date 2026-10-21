/**
 * B546: market salary estimates, computed in the maintenance process only.
 *
 * One streamed pass over salaried live vacancies (`iterate`, never the whole
 * pool in memory): each midpoint goes to a city group and a region group of
 * the same normalised function and level. The result replaces
 * `market_salary_estimates`; the web server reads it by primary key.
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  estimateFromMidpoints,
  marketSalaryCity,
  marketSalaryKey,
  salaryMidpoint,
  type MarketSalaryEstimate,
} from '../../../shared/marketSalaryEstimate';
import { regionOfVacancy } from '../vacancyGeography';

export const MARKET_SALARY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS market_salary_estimates (
  key TEXT PRIMARY KEY,
  low INTEGER,
  high INTEGER,
  currency TEXT NOT NULL,
  sample_size INTEGER NOT NULL,
  computed_at TEXT NOT NULL
) STRICT`;

interface SalariedRow {
  readonly function_code: string;
  readonly level_rank: number | null;
  readonly salary_from: number | null;
  readonly salary_to: number | null;
  readonly currency: string | null;
  readonly location: string | null;
}

type Groups = Map<string, Map<string, number[]>>;

function addSample(groups: Groups, key: string, currency: string, midpoint: number): void {
  const byCurrency = groups.get(key) ?? new Map<string, number[]>();
  const values = byCurrency.get(currency) ?? [];
  values.push(midpoint);
  byCurrency.set(currency, values);
  groups.set(key, byCurrency);
}

/** Dominant currency of a group: no exchange rates exist, so others are dropped. */
function dominant(byCurrency: Map<string, number[]>): [string, number[]] {
  let best: [string, number[]] = ['', []];
  for (const entry of byCurrency) if (entry[1].length > best[1].length) best = entry;
  return best;
}

export function computeMarketSalaryEstimates(
  database: DatabaseSync,
): Map<string, MarketSalaryEstimate> {
  const rows = database
    .prepare(
      `SELECT s.function_code, s.level_rank,
              json_extract(p.payload, '$.salary.from') AS salary_from,
              json_extract(p.payload, '$.salary.to') AS salary_to,
              json_extract(p.payload, '$.salary.currency') AS currency,
              json_extract(p.payload, '$.location') AS location
       FROM vacancy_semantic s
       JOIN vacancy_pool_index i ON i.id = s.id
       JOIN vacancy_pool p ON p.id = s.id
       WHERE i.is_active = 1 AND i.expired = 0
         AND json_extract(p.payload, '$.salary.currency') IS NOT NULL`,
    )
    .iterate() as Iterable<SalariedRow>;
  const groups: Groups = new Map();
  for (const row of rows) {
    const midpoint = salaryMidpoint({ from: row.salary_from, to: row.salary_to });
    if (midpoint === undefined || !row.currency) continue;
    const currency = row.currency.toUpperCase();
    const city = marketSalaryCity(row.location);
    const region = regionOfVacancy({ location: row.location ?? undefined });
    if (city) {
      addSample(
        groups,
        marketSalaryKey(row.function_code, row.level_rank, 'city', city),
        currency,
        midpoint,
      );
    }
    if (region) {
      addSample(
        groups,
        marketSalaryKey(row.function_code, row.level_rank, 'region', region),
        currency,
        midpoint,
      );
    }
  }
  const estimates = new Map<string, MarketSalaryEstimate>();
  for (const [key, byCurrency] of groups) {
    const [currency, midpoints] = dominant(byCurrency);
    estimates.set(key, estimateFromMidpoints(midpoints, currency));
  }
  return estimates;
}

export function writeMarketSalaryEstimates(
  database: DatabaseSync,
  estimates: ReadonlyMap<string, MarketSalaryEstimate>,
  now: Date,
): void {
  database.exec(MARKET_SALARY_TABLE_SQL);
  const insert = database.prepare(
    'INSERT INTO market_salary_estimates (key, low, high, currency, sample_size, computed_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const computedAt = now.toISOString();
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec('DELETE FROM market_salary_estimates');
    for (const [key, estimate] of estimates) {
      insert.run(
        key,
        estimate.low ?? null,
        estimate.high ?? null,
        estimate.currency,
        estimate.sampleSize,
        computedAt,
      );
    }
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
}
