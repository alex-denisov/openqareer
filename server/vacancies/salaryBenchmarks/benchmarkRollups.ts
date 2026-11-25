/**
 * B803: при пересборке считается то, что не нужно считать на запрос: сводки строк
 * места, мировые оценки функции и уровня, множители уровней.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { CurrencyRates } from '../../../shared/currencyRates';
import { normalizeTitleKey } from '../titleParse/normalizeTitleKey';
import { cellGroup } from './benchmarkCells';
import { levelMultipliers } from './levelMultipliers';
import type { SalaryBenchmark } from './salaryBenchmark';
import { worldSalaryEstimate } from './worldSalaryEstimate';

export const ROLLUP_TABLES_SQL = `CREATE TABLE IF NOT EXISTS salary_benchmark_cells (
  place TEXT NOT NULL, key TEXT NOT NULL, group_json TEXT NOT NULL, PRIMARY KEY (place, key)
) STRICT, WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS salary_world_estimates (
  key TEXT PRIMARY KEY, result_json TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS salary_level_multipliers (
  key TEXT PRIMARY KEY, value REAL NOT NULL
) STRICT`;

const LEVELS = [0, 1, 2, 3, 4] as const;

export const titleKeyOf = (title: string): string => `t:${normalizeTitleKey(title)}`;
export const familyKeyOf = (functionCode: string, levelRank: number | null): string =>
  `f:${functionCode}|${levelRank ?? '-'}`;
export const worldKeyOf = (functionCode: string, levelRank: number): string =>
  `${functionCode}|${levelRank}`;

function keysOf(row: SalaryBenchmark): string[] {
  const titles = [row.role, ...row.roleAliases].map(titleKeyOf);
  const family = row.functionCode ? [familyKeyOf(row.functionCode, row.levelRank)] : [];
  return [...new Set([...titles, ...family])];
}

function writeWorld(
  database: DatabaseSync,
  rows: readonly SalaryBenchmark[],
  rates: CurrencyRates | undefined,
  now: Date,
): void {
  const insert = database.prepare('INSERT INTO salary_world_estimates VALUES (?, ?)');
  const byFunction = new Map<string, SalaryBenchmark[]>();
  for (const row of rows) {
    if (!row.functionCode) continue;
    const family = byFunction.get(row.functionCode);
    if (family) family.push(row);
    else byFunction.set(row.functionCode, [row]);
  }
  for (const [functionCode, family] of byFunction) {
    for (const levelRank of LEVELS) {
      const result = worldSalaryEstimate(family, { functionCode, levelRank }, rates, now);
      if (result) insert.run(worldKeyOf(functionCode, levelRank), JSON.stringify(result));
    }
  }
}

function writeCells(
  database: DatabaseSync,
  rows: readonly SalaryBenchmark[],
  placeKey: (row: SalaryBenchmark) => string,
): void {
  const groups = new Map<string, SalaryBenchmark[]>();
  for (const row of rows)
    for (const key of keysOf(row)) {
      const name = JSON.stringify([placeKey(row), key]);
      const group = groups.get(name);
      if (group) group.push(row);
      else groups.set(name, [row]);
    }
  const insert = database.prepare('INSERT INTO salary_benchmark_cells VALUES (?, ?, ?)');
  for (const [name, group] of groups) {
    const [place, key] = JSON.parse(name) as [string, string];
    insert.run(place, key, JSON.stringify(cellGroup(group)));
  }
}

/** Внутри транзакции пересборки. */
export function writeRollups(
  database: DatabaseSync,
  rows: readonly SalaryBenchmark[],
  placeKey: (row: SalaryBenchmark) => string,
  rates: CurrencyRates | undefined,
  now: Date,
): void {
  database.exec(`DELETE FROM salary_benchmark_cells; DELETE FROM salary_world_estimates;
    DELETE FROM salary_level_multipliers`);
  writeCells(database, rows, placeKey);
  writeWorld(database, rows, rates, now);
  const multiplier = database.prepare('INSERT INTO salary_level_multipliers VALUES (?, ?)');
  for (const [name, value] of levelMultipliers(rows)) multiplier.run(name, value);
}
