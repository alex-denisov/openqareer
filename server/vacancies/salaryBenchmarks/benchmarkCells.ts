/**
 * B803: строки одного места и ключа, сведённые при пересборке. Ячейка — строки источника с одинаковыми
 * признаками: их среднее и число дают при чтении тот же итог, что и сами строки.
 */
import { normalizeCityLabel } from '../../../shared/cityLabel';
import { blendInputOf, type BlendInput } from './blendSalaryBenchmarks';
import { BENCHMARK_PRECISIONS, type BenchmarkPrecision } from './pickSalaryBenchmark';
import { BENCHMARK_SOURCE_KINDS, type SalaryBenchmark } from './salaryBenchmark';
import { PER_YEAR, type SourceRange } from './sourceRanges';

export interface BenchmarkCell {
  readonly city: string | null;
  readonly region: boolean;
  readonly input: BlendInput;
}
export interface CellGroup {
  readonly cells: readonly BenchmarkCell[];
  /** Исходные вилки: показанная не должна повторять ни одну. */
  readonly ranges: readonly SourceRange[];
}
export const NO_CELLS: CellGroup = { cells: [], ranges: [] };

export function cityKey(city: string | null | undefined): string | null {
  return city ? (normalizeCityLabel(city) ?? city).trim().toLocaleLowerCase('ru-RU') : null;
}

const byPriority = (left: SalaryBenchmark, right: SalaryBenchmark): number =>
  BENCHMARK_SOURCE_KINDS.indexOf(left.sourceKind) -
    BENCHMARK_SOURCE_KINDS.indexOf(right.sourceKind) ||
  right.year - left.year ||
  (right.sampleSize ?? 0) - (left.sampleSize ?? 0) ||
  left.id.localeCompare(right.id);

function averaged(inputs: readonly BlendInput[], first: BlendInput): BlendInput {
  const mean = (side: 'low' | 'high') =>
    inputs.reduce((sum, input) => sum + input[side], 0) / inputs.length;
  return { ...first, low: mean('low'), high: mean('high'), count: inputs.length };
}

export function cellGroup(rows: readonly SalaryBenchmark[]): CellGroup {
  const groups = new Map<string, { cell: Omit<BenchmarkCell, 'input'>; inputs: BlendInput[] }>();
  const ranges = new Map<string, SourceRange>();
  for (const row of [...rows].sort(byPriority)) {
    const input = blendInputOf(row);
    if (!input || PER_YEAR[input.period] === undefined) continue;
    const { low, high, currency, period } = input;
    ranges.set([low, high, currency, period].join('|'), { low, high, currency, period });
    const cell = { city: cityKey(row.city), region: row.region !== null };
    const key = JSON.stringify([cell, { ...input, low: 0, high: 0 }]);
    const group = groups.get(key);
    if (group) group.inputs.push(input);
    else groups.set(key, { cell, inputs: [input] });
  }
  const cells = [...groups.values()].flatMap(({ cell, inputs }) =>
    inputs[0] ? [{ ...cell, input: averaged(inputs, inputs[0]) }] : [],
  );
  return { cells, ranges: [...ranges.values()] };
}

export interface CellMatch {
  readonly precision: BenchmarkPrecision;
  readonly inputs: readonly BlendInput[];
}

/** Все ячейки самой точной ступени. */
export function matchCells(
  role: CellGroup,
  family: CellGroup,
  city: string | undefined,
): CellMatch | undefined {
  const wanted = cityKey(city);
  const placed = (group: CellGroup, level: 'role' | 'family') =>
    group.cells.flatMap(({ city: own, region, input }) => {
      if (own !== null && own !== wanted) return [];
      const place = region ? 'region' : own === null ? 'country' : 'city';
      return [{ precision: `${level}-${place}` as const, input }];
    });
  const all = [...placed(role, 'role'), ...placed(family, 'family')];
  for (const precision of BENCHMARK_PRECISIONS) {
    const inputs = all.filter((match) => match.precision === precision).map(({ input }) => input);
    if (inputs.length > 0) return { precision, inputs };
  }
  return undefined;
}
