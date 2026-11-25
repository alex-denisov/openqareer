/** B803: чтение цифр по ключам — только нужные строки места; таблиц ещё нет — пусто. */
import type { DatabaseSync } from 'node:sqlite';
import { worldKeyOf } from './benchmarkRollups';
import type { BlendResult } from './blendSalaryBenchmarks';
import { salaryBenchmarkSchema, type SalaryBenchmark } from './salaryBenchmark';

export interface BenchmarkLookup {
  rows(places: readonly string[], keys: readonly string[]): readonly SalaryBenchmark[];
  world(functionCode: string, levelRank: number): BlendResult | undefined;
  readonly multipliers: { get(key: string): number | undefined };
}

function prepareAll(database: DatabaseSync) {
  return {
    rows: database.prepare(`SELECT b.row_json FROM salary_benchmark_keys k
      JOIN salary_benchmarks b ON b.id = k.id WHERE k.place = ? AND k.key = ? ORDER BY k.id`),
    world: database.prepare('SELECT result_json FROM salary_world_estimates WHERE key = ?'),
    multiplier: database.prepare('SELECT value FROM salary_level_multipliers WHERE key = ?'),
  };
}

export function createBenchmarkLookup(database: DatabaseSync): BenchmarkLookup {
  let statements: ReturnType<typeof prepareAll> | undefined;
  const prepared = () => {
    try {
      statements ??= prepareAll(database);
    } catch (error: unknown) {
      if (!(error instanceof Error && error.message.includes('no such table'))) throw error;
    }
    return statements;
  };
  return {
    rows(places, keys) {
      const statement = prepared()?.rows;
      if (!statement) return [];
      const found = places.flatMap((place) =>
        keys.flatMap((key) => statement.all(place, key) as { row_json: string }[]),
      );
      const texts = [...new Set(found.map(({ row_json }) => row_json))];
      return texts.map((text) => salaryBenchmarkSchema.parse(JSON.parse(text)));
    },
    world(functionCode, levelRank) {
      const row = prepared()?.world.get(worldKeyOf(functionCode, levelRank)) as
        { result_json: string } | undefined;
      return row ? (JSON.parse(row.result_json) as BlendResult) : undefined;
    },
    multipliers: {
      get: (key) => (prepared()?.multiplier.get(key) as { value: number } | undefined)?.value,
    },
  };
}
