/**
 * B546: market salary estimates, computed in the maintenance process only.
 *
 * Rowid slices over salaried live vacancies (never the whole pool in memory):
 * each midpoint goes to a city group and a country group of
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
  type MarketSalaryPeriod,
} from '../../../shared/marketSalaryEstimate';
import { marketSalaryCityPlace, marketSalaryCountry } from './marketSalaryCountry';

export const MARKET_SALARY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS market_salary_estimates (
  key TEXT PRIMARY KEY,
  low INTEGER,
  high INTEGER,
  currency TEXT NOT NULL,
  period TEXT,
  sample_size INTEGER NOT NULL,
  computed_at TEXT NOT NULL
) STRICT`;

interface SalariedRow {
  readonly function_code: string;
  readonly level_rank: number | null;
  readonly salary_from: number | null;
  readonly salary_to: number | null;
  readonly currency: string | null;
  readonly period: string | null;
  readonly location: string | null;
}

/** Ключ группы → «валюта|период» → середины вилок. */
type Groups = Map<string, Map<string, number[]>>;

function addSample(groups: Groups, key: string, unit: string, midpoint: number): void {
  const byUnit = groups.get(key) ?? new Map<string, number[]>();
  const values = byUnit.get(unit) ?? [];
  values.push(midpoint);
  byUnit.set(unit, values);
  groups.set(key, byUnit);
}

/** Dominant currency and period of a group: amounts are never converted, others are dropped. */
function dominant(byUnit: Map<string, number[]>): [string, number[]] {
  let best: [string, number[]] = ['', []];
  for (const entry of byUnit) if (entry[1].length > best[1].length) best = entry;
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
const SLICE_SQL = `SELECT s.function_code, s.level_rank, c.salary_from, c.salary_to, c.currency, c.period, c.location
  FROM (SELECT id,
          json_extract(cluster_json, '$.salary.from') AS salary_from,
          json_extract(cluster_json, '$.salary.to') AS salary_to,
          json_extract(cluster_json, '$.salary.currency') AS currency,
          json_extract(cluster_json, '$.salary.period') AS period,
          json_extract(cluster_json, '$.location') AS location
        FROM vacancy_cluster_input WHERE rowid > ? AND rowid <= ?) c
  CROSS JOIN vacancy_pool_index i ON i.id = c.id AND i.is_active = 1 AND i.expired = 0
  CROSS JOIN vacancy_semantic s ON s.id = c.id
  WHERE c.salary_from IS NOT NULL OR c.salary_to IS NOT NULL`;

/**
 * Валюта и период суммы. Период назвала площадка; без него в оценку входят только рубли (месяц):
 * в иностранной ленте по сумме не отличить час, месяц и год.
 */
function unitOf(row: SalariedRow): string | undefined {
  const code = row.currency?.trim().toUpperCase();
  if (!code) return undefined;
  // hh пишет RUR, остальные RUB: одна валюта — одна группа.
  const currency = code === 'RUB' ? 'RUR' : code;
  const period = row.period || (currency === 'RUR' ? 'month' : undefined);
  return period === 'month' || period === 'year' ? `${currency}|${period}` : undefined;
}

function addRow(groups: Groups, row: SalariedRow): void {
  const midpoint = salaryMidpoint({ from: row.salary_from, to: row.salary_to });
  if (midpoint === undefined) return;
  const unit = unitOf(row);
  const country = marketSalaryCountry(row.location);
  if (!unit || !country) return;
  const city = marketSalaryCity(row.location);
  const add = (basis: 'city' | 'country', place: string) =>
    addSample(
      groups,
      marketSalaryKey(row.function_code, row.level_rank, basis, place),
      unit,
      midpoint,
    );
  if (city) add('city', marketSalaryCityPlace(country, city));
  add('country', country);
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
  for (const [key, byUnit] of groups) {
    const [unit, midpoints] = dominant(byUnit);
    const [currency = '', period] = unit.split('|');
    estimates.set(key, estimateFromMidpoints(midpoints, currency, period as MarketSalaryPeriod));
  }
  return estimates;
}

function addPeriodColumn(database: DatabaseSync): void {
  const exists = database
    .prepare("SELECT 1 FROM pragma_table_info('market_salary_estimates') WHERE name = 'period'")
    .get();
  if (!exists) database.exec('ALTER TABLE market_salary_estimates ADD COLUMN period TEXT');
}

export function writeMarketSalaryEstimates(
  database: DatabaseSync,
  estimates: ReadonlyMap<string, MarketSalaryEstimate>,
  now: Date,
): void {
  database.exec(MARKET_SALARY_TABLE_SQL);
  addPeriodColumn(database);
  const insert = database.prepare(
    'INSERT INTO market_salary_estimates (key, low, high, currency, period, sample_size, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
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
        estimate.period ?? null,
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
