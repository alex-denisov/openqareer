/**
 * B803: собственная оценка openqareer — сведение источников одной ступени точности.
 * Наружу уходят только диапазон, валюта, период и дата: имена, ссылки и выборка источников
 * остаются на сервере. Нет данных — нет оценки.
 */
import { convertAmount, type CurrencyRates } from '../../../shared/currencyRates';
import type { BenchmarkPrecision } from './pickSalaryBenchmark';
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
/** Ставка часа и дня с окладом не сводится: сколько часов в месяце, источник не говорит. */
export const PER_YEAR: Readonly<Partial<Record<Period, number>>> = { year: 1, month: 12 };

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

/** Сумма в валюте и периоде опорного источника; нет курса — источник не участвует. */
function convertTo(input: BlendInput, base: BlendInput, rates: CurrencyRates | undefined) {
  const from = PER_YEAR[input.period];
  const to = PER_YEAR[base.period];
  const factor = input.period === base.period ? 1 : from && to ? from / to : undefined;
  if (factor === undefined) return undefined;
  const low = convertAmount(input.low * factor, input.currency, base.currency, rates);
  const high = convertAmount(input.high * factor, input.currency, base.currency, rates);
  return low === undefined || high === undefined ? undefined : { low, high };
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

export function stepOf(value: number): number {
  if (value >= 50_000) return 10_000;
  if (value >= 5_000) return 1_000;
  if (value >= 1_000) return 100;
  if (value >= 100) return 10;
  return value >= 10 ? 1 : 0.1;
}

export function roundTo(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(1));
}

interface Range {
  readonly low: number;
  readonly high: number;
}

function rounded({ low, high }: Range): Range {
  const step = stepOf(low);
  return { low: roundTo(low, step), high: roundTo(high, step) };
}

/** Округлённая вилка, которая не повторяет вилку ни одного из источников. */
export function hideSourceRange(range: Range, sources: readonly Range[], always = false): Range {
  const plain = rounded(range);
  const repeats = sources.some((source) => {
    const own = rounded(source);
    return own.low === plain.low && own.high === plain.high;
  });
  if (!always && !repeats) return plain;
  return rounded({
    low: range.low * (1 - SINGLE_SOURCE_SPREAD),
    high: range.high * (1 + SINGLE_SOURCE_SPREAD),
  });
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
  const converted = ordered.flatMap((input) => {
    const range = convertTo(input, base, rates);
    return range
      ? [{ ...range, name: input.sourceName, tax: input.tax, weight: weightOf(input, year) }]
      : [];
  });
  // Источник голосует один раз, сколько бы строк он ни дал.
  const rowsOf = (source: string) => converted.filter(({ name }) => name === source).length;
  const used = converted.map((row) => ({ ...row, weight: row.weight / rowsOf(row.name) }));
  const total = used.reduce((sum, { weight }) => sum + weight, 0);
  if (total <= 0) return undefined;
  const single = new Set(used.map(({ name }) => name)).size === 1;
  const mean = (pick: 'low' | 'high') =>
    used.reduce((sum, row) => sum + row[pick] * row.weight, 0) / total;
  const range = hideSourceRange({ low: mean('low'), high: mean('high') }, used, single);
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
