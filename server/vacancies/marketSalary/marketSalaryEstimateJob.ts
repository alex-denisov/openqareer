/**
 * B546: market salary estimates, computed in the maintenance process only.
 *
 * Rowid slices over salaried live vacancies (never the whole pool in memory):
 * each midpoint goes to a city group and a region group of
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

export interface MarketSalarySliceOptions {
  readonly sliceRows?: number;
  readonly pause?: () => Promise<void>;
}

/** Номеров строк за порцию: на проде около 0,08 с чтения. */
const DEFAULT_SLICE_ROWS = 1_000;
const SLICE_PAUSE_MS = 50;

/**
 * B803 25.11: проход шёл от `vacancy_semantic` (2,7 млн строк, по трём таблицам на каждую) 34 мин и
 * не успевал между выкатами. Зарплата есть у меньшинства: сначала проекция по номеру строки,
 * остальное — только для строк с зарплатой. Проекция есть у всех живых вакансий (выборка 39 626).
 */
const SLICE_SQL = `SELECT s.function_code, s.level_rank, c.salary_from, c.salary_to, c.currency, c.location
  FROM (SELECT id,
          json_extract(cluster_json, '$.salary.from') AS salary_from,
          json_extract(cluster_json, '$.salary.to') AS salary_to,
          json_extract(cluster_json, '$.salary.currency') AS currency,
          json_extract(cluster_json, '$.location') AS location
        FROM vacancy_cluster_input WHERE rowid > ? AND rowid <= ?) c
  CROSS JOIN vacancy_pool_index i ON i.id = c.id AND i.is_active = 1 AND i.expired = 0
  CROSS JOIN vacancy_semantic s ON s.id = c.id
  WHERE c.salary_from IS NOT NULL OR c.salary_to IS NOT NULL`;

function addRow(groups: Groups, row: SalariedRow): void {
  const midpoint = salaryMidpoint({ from: row.salary_from, to: row.salary_to });
  if (midpoint === undefined || !row.currency) return;
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

/**
 * Порции по ключу вместо одного прохода: прод 06.11, цельный проход держал
 * очередь обслуживания 158-189 с раз в 6 часов. Строка, изменившаяся между
 * порциями, попадёт в оценку в своём новом виде: для квартилей это не важно.
 */
export async function computeMarketSalaryEstimates(
  database: DatabaseSync,
  options: MarketSalarySliceOptions = {},
): Promise<Map<string, MarketSalaryEstimate>> {
  const sliceRows = options.sliceRows ?? DEFAULT_SLICE_ROWS;
  const pause =
    options.pause ?? (() => new Promise<void>((done) => setTimeout(done, SLICE_PAUSE_MS)));
  const statement = database.prepare(SLICE_SQL);
  const groups: Groups = new Map();
  const { last } = database
    .prepare('SELECT coalesce(max(rowid), 0) AS last FROM vacancy_cluster_input')
    .get() as { last: number };
  for (let from = 0; from < last; from += sliceRows) {
    if (from > 0) await pause();
    const rows = statement.all(from, from + sliceRows) as unknown as SalariedRow[];
    for (const row of rows) addRow(groups, row);
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
