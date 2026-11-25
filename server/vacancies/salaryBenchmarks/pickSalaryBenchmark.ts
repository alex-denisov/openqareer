/**
 * B803: лестница точности. Сначала самая точная ступень по должности и месту, при равной —
 * источник по приоритету владельца: агентство → портал и каталог → СМИ → госданные.
 */
import { normalizeCityLabel } from '../../../shared/cityLabel';
import { normalizeTitleKey } from '../titleParse/normalizeTitleKey';
import {
  BENCHMARK_SOURCE_KINDS,
  type BenchmarkSourceKind,
  type SalaryBenchmark,
} from './salaryBenchmark';

/** Порядок — от точной к грубой. Город каталога сгруппирован по функции и уровню, не по должности. */
export const BENCHMARK_PRECISIONS = [
  'role-city',
  'role-country',
  'family-city',
  'family-country',
  'role-region',
  'family-region',
] as const;
export type BenchmarkPrecision = (typeof BENCHMARK_PRECISIONS)[number];

export interface BenchmarkQuery {
  readonly title: string;
  readonly functionCode?: string;
  readonly levelRank: number | null;
  readonly country?: string;
  readonly region?: string;
  readonly city?: string;
}

export interface BenchmarkMatch {
  readonly benchmark: SalaryBenchmark;
  readonly precision: BenchmarkPrecision;
}

/** Head и выше: средняя без уровня для них неверна. */
const MANAGER_RANK = 2;

function sameRole(row: SalaryBenchmark, titleKey: string): boolean {
  return [row.role, ...row.roleAliases].some((title) => normalizeTitleKey(title) === titleKey);
}

function sameFamily(row: SalaryBenchmark, query: BenchmarkQuery): boolean {
  if (!query.functionCode || row.functionCode !== query.functionCode) return false;
  if (row.levelRank !== null) return row.levelRank === query.levelRank;
  return (query.levelRank ?? 0) < MANAGER_RANK;
}

function cityKey(city: string | null | undefined): string | undefined {
  return city ? (normalizeCityLabel(city) ?? city).trim().toLocaleLowerCase('ru-RU') : undefined;
}

function placeOf(
  row: SalaryBenchmark,
  query: BenchmarkQuery,
): 'city' | 'country' | 'region' | undefined {
  if (row.region !== null) return row.region === query.region ? 'region' : undefined;
  if (!query.country || row.country !== query.country) return undefined;
  if (row.city === null) return 'country';
  return cityKey(row.city) === cityKey(query.city) ? 'city' : undefined;
}

function precisionOf(
  row: SalaryBenchmark,
  query: BenchmarkQuery,
  titleKey: string,
): BenchmarkPrecision | undefined {
  const place = placeOf(row, query);
  if (!place) return undefined;
  if (sameRole(row, titleKey)) return `role-${place}`;
  return sameFamily(row, query) ? `family-${place}` : undefined;
}

export function comparePrecision(
  left: { readonly precision: BenchmarkPrecision; readonly kind: BenchmarkSourceKind },
  right: { readonly precision: BenchmarkPrecision; readonly kind: BenchmarkSourceKind },
): number {
  return (
    BENCHMARK_PRECISIONS.indexOf(left.precision) - BENCHMARK_PRECISIONS.indexOf(right.precision) ||
    BENCHMARK_SOURCE_KINDS.indexOf(left.kind) - BENCHMARK_SOURCE_KINDS.indexOf(right.kind)
  );
}

function compareMatches(left: BenchmarkMatch, right: BenchmarkMatch): number {
  return (
    comparePrecision(
      { precision: left.precision, kind: left.benchmark.sourceKind },
      { precision: right.precision, kind: right.benchmark.sourceKind },
    ) ||
    right.benchmark.year - left.benchmark.year ||
    (right.benchmark.sampleSize ?? 0) - (left.benchmark.sampleSize ?? 0) ||
    left.benchmark.id.localeCompare(right.benchmark.id)
  );
}

export function pickSalaryBenchmark(
  rows: readonly SalaryBenchmark[],
  query: BenchmarkQuery,
): BenchmarkMatch | undefined {
  const titleKey = normalizeTitleKey(query.title);
  return rows
    .flatMap((benchmark) => {
      const precision = precisionOf(benchmark, query, titleKey);
      return precision ? [{ benchmark, precision }] : [];
    })
    .sort(compareMatches)[0];
}

/** Оценка каталога — портальный слой: она уступает только более точной или агентской той же точности. */
export function benchmarkBeatsCatalog(
  match: BenchmarkMatch,
  catalogBasis: 'city' | 'country' | undefined,
): boolean {
  if (!catalogBasis) return true;
  return (
    comparePrecision(
      { precision: match.precision, kind: match.benchmark.sourceKind },
      { precision: `family-${catalogBasis}`, kind: 'portal' },
    ) < 0
  );
}
