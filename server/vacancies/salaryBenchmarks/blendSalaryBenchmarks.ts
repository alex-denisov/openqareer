/**
 * B803: собственная оценка openqareer — сведение источников одной ступени точности.
 * Наружу уходят только диапазон, валюта, период и дата: имена, ссылки и выборка источников
 * остаются на сервере. Нет данных — нет оценки.
 */
import type { CurrencyRates } from '../../../shared/currencyRates';
import type { BenchmarkPrecision } from './pickSalaryBenchmark';
import { convertRange, distinctRange, rounded, type Range } from './sourceRanges';
import type { BenchmarkSourceKind, SalaryBenchmark } from './salaryBenchmark';

type Period = SalaryBenchmark['period'];
type Tax = SalaryBenchmark['tax'];
type PayBase = SalaryBenchmark['payBase'];

/** Цифра источника или оценка каталога, приведённая к одному виду. */
export interface BlendInput {
  readonly kind: BenchmarkSourceKind;
  readonly sourceName: string;
  readonly low: number;
  readonly high: number;
  readonly currency: string;
  readonly period: Period;
  readonly tax: Tax;
  readonly payBase: PayBase;
  readonly year: number;
  readonly confidence: SalaryBenchmark['confidence'];
  /** Сколько строк сведено в эту цифру; нет — одна. */
  readonly count?: number;
}

/** Только то, что можно отдать экрану. */
export interface OpenqareerSalaryEstimate {
  readonly low: number;
  readonly high: number;
  readonly currency: string;
  readonly period: Period;
  /** До или после налога; `unknown` — ни один источник не сказал. */
  readonly tax: Tax;
  readonly computedAt: string;
}

export interface BlendResult {
  readonly estimate: OpenqareerSalaryEstimate;
  /** Внутренняя пометка: в ответ API не входит. */
  readonly precision: BenchmarkPrecision | 'family-world';
  readonly lowConfidence: boolean;
}

const KIND_WEIGHT: Readonly<Record<BenchmarkSourceKind, number>> = {
  agency: 4,
  portal: 3,
  media: 2,
  gov: 1,
};
/** Вес цифры, у которой период или вид выведен, а не назван. */
const REDUCED_WEIGHT = 0.5;
/** Каждый год возраста снижает вес. */
const YEAR_DECAY = 0.7;
/** Одна цифра, от одного источника или совпавшая у всех: границы раздвигаются, чтобы не повторять его цифру и не обещать точность. */
export const SINGLE_SOURCE_SPREAD = 0.1;
/** Источник назвал только медиану: границ у него нет. */
const MEDIAN_SPREAD = 0.15;
export function blendInputOf(row: SalaryBenchmark): BlendInput | undefined {
  const { low, high, median } = row;
  const range =
    low !== null && high !== null
      ? { low, high }
      : median !== null
        ? { low: median * (1 - MEDIAN_SPREAD), high: median * (1 + MEDIAN_SPREAD) }
        : undefined;
  return range
    ? {
        kind: row.sourceKind,
        sourceName: row.sourceName,
        ...range,
        currency: row.currency,
        period: row.period,
        tax: row.tax,
        payBase: row.payBase,
        year: row.year,
        confidence: row.confidence,
      }
    : undefined;
}

function weightOf(input: BlendInput, year: number): number {
  const trust = input.confidence === 'reduced' ? REDUCED_WEIGHT : 1;
  return trust * KIND_WEIGHT[input.kind] * YEAR_DECAY ** Math.max(0, year - input.year);
}

/** Неизвестное сводится с известным; два разных известных — никогда. */
export function oneKind<Input, Value extends string>(
  inputs: readonly Input[],
  read: (input: Input) => Value | 'unknown',
  preferred?: Value,
): readonly Input[] {
  const known = inputs.map(read).filter((value) => value !== 'unknown');
  const kind = known.find((value) => value === preferred) ?? known[0];
  return inputs.filter((input) => read(input) === 'unknown' || read(input) === kind);
}

/** Одна цифра, или граница, одинаковая у всех, раздвигается: чужого числа в ответе нет. */
function spreadBounds(mean: Range, inputs: readonly Range[], single: boolean): Range {
  const same = (side: 'low' | 'high') => inputs.every((input) => input[side] === inputs[0]?.[side]);
  return {
    low: mean.low * (single || same('low') ? 1 - SINGLE_SOURCE_SPREAD : 1),
    high: mean.high * (single || same('high') ? 1 + SINGLE_SOURCE_SPREAD : 1),
  };
}

/** Источник голосует один раз, сколько бы строк он ни дал. */
function weighted(
  inputs: readonly BlendInput[],
  base: BlendInput,
  rates: CurrencyRates | undefined,
  year: number,
) {
  const converted = inputs.flatMap((input) => {
    const range = convertRange(input, base, rates);
    const { sourceName: name, tax, count = 1 } = input;
    return range ? [{ ...range, name, tax, weight: weightOf(input, year), count }] : [];
  });
  const rowsOf = new Map<string, number>();
  for (const { name, count } of converted) rowsOf.set(name, (rowsOf.get(name) ?? 0) + count);
  return converted.map((row) => ({
    ...row,
    weight: (row.weight * row.count) / (rowsOf.get(row.name) ?? 1),
  }));
}

export function blendSalary(
  inputs: readonly BlendInput[],
  precision: BenchmarkPrecision,
  rates: CurrencyRates | undefined,
  now: Date,
): BlendResult | undefined {
  const year = now.getUTCFullYear();
  const sorted = [...inputs].sort(
    (a, b) => weightOf(b, year) - weightOf(a, year) || b.year - a.year,
  );
  const ordered = oneKind(
    oneKind(sorted, (input) => input.payBase, 'base'),
    (input) => input.tax,
  );
  const [base] = ordered;
  if (!base) return undefined;
  const used = weighted(ordered, base, rates, year);
  const total = used.reduce((sum, { weight }) => sum + weight, 0);
  if (total <= 0) return undefined;
  const single = new Set(used.map(({ name }) => name)).size === 1;
  const mean = (pick: 'low' | 'high') =>
    used.reduce((sum, row) => sum + row[pick] * row.weight, 0) / total;
  const spread = spreadBounds({ low: mean('low'), high: mean('high') }, used, single);
  const range = distinctRange(rounded(spread), base, ordered, rates);
  if (!range) return undefined;
  return {
    estimate: {
      ...range,
      currency: base.currency,
      period: base.period,
      tax: used.find(({ tax }) => tax !== 'unknown')?.tax ?? 'unknown',
      computedAt: now.toISOString(),
    },
    precision,
    lowConfidence: single,
  };
}
