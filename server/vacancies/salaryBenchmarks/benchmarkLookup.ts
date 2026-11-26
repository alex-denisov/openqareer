/** B803: чтение цифр по ключам — только сводка места; таблиц ещё нет — пусто. */
import type { DatabaseSync } from 'node:sqlite';
import { worldKeyOf } from './benchmarkRollups';
import type { BlendResult } from './blendSalaryBenchmarks';
import { NO_CELLS, type CellGroup } from './benchmarkCells';

export interface BenchmarkLookup {
  group(places: readonly string[], keys: readonly string[]): CellGroup;
  world(functionCode: string, levelRank: number): BlendResult | undefined;
  readonly multipliers: { get(key: string): number | undefined };
}

function prepareAll(database: DatabaseSync) {
  return {
    group: database.prepare(
      'SELECT group_json FROM salary_benchmark_cells WHERE place = ? AND key = ?',
    ),
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
    group(places, keys) {
      const statement = prepared()?.group;
      if (!statement) return NO_CELLS;
      const groups = places.flatMap((place) =>
        keys.flatMap((key) => {
          const row = statement.get(place, key) as { group_json: string } | undefined;
          return row ? [JSON.parse(row.group_json) as CellGroup] : [];
        }),
      );
      return {
        cells: groups.flatMap(({ cells }) => cells),
        ranges: groups.flatMap(({ ranges }) => ranges),
      };
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
