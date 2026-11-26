/** B803: разовая загрузка собранных срезов. Сбой источника не мешает остальным; цифр в итоге нет. */
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  previewSalarySlice,
  writeSalarySlice,
  type WrittenSlice,
} from './sqliteSalaryBenchmarkStore';

const bundleSchema = z.object({
  sources: z.array(z.looseObject({ name: z.string() })).max(500),
  benchmarks: z.array(z.looseObject({ sourceName: z.string(), readOn: z.string() })).max(50_000),
});

export interface ImportedSource extends WrittenSlice {
  /** Номер источника во входе: имён в журналах нет. */
  readonly number: number;
  readonly error?: string;
}

function failureOf(error: unknown): string {
  if (error instanceof z.ZodError) return `invalid slice: ${error.issues.length} problems`;
  return error instanceof Error ? error.name : 'UnknownError';
}

export function importSalarySlices(
  database: DatabaseSync,
  input: unknown,
  dryRun = false,
): ImportedSource[] {
  const write = dryRun ? previewSalarySlice : writeSalarySlice;
  const { sources, benchmarks } = bundleSchema.parse(input);
  const names = new Set(sources.map(({ name }) => name));
  if (names.size !== sources.length) throw new Error('duplicate source');
  if (benchmarks.some(({ sourceName }) => !names.has(sourceName)))
    throw new Error('unknown source');
  return sources.map((source, index) => {
    const number = index + 1;
    const rows = benchmarks.filter(({ sourceName }) => sourceName === source.name);
    const sliceDate = rows
      .map(({ readOn }) => readOn)
      .sort()
      .at(-1);
    try {
      const result = write(database, { source, sliceDate, benchmarks: rows });
      return { number, ...result };
    } catch (error: unknown) {
      return { number, written: 0, error: failureOf(error) };
    }
  });
}
