/** B803: ни одна показанная вилка не повторяет вилку источника ни в своём периоде, ни в месяц. */
import { convertAmount, type CurrencyRates } from '../../../shared/currencyRates';
import { monthlyMarketEstimate } from '../../../shared/marketSalaryEstimate';
import type { SalaryBenchmark } from './salaryBenchmark';

type Period = SalaryBenchmark['period'];
export interface Range {
  readonly low: number;
  readonly high: number;
}
export interface SourceRange extends Range {
  readonly currency: string;
  readonly period: Period;
}

/** Ставка часа и дня с окладом не сводится: сколько часов в месяце, источник не говорит. */
export const PER_YEAR: Readonly<Partial<Record<Period, number>>> = { year: 1, month: 12 };
const MAX_SHIFTS = 12;

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

export function rounded({ low, high }: Range): Range {
  const step = stepOf(low);
  return { low: roundTo(low, step), high: roundTo(high, step) };
}

/** Сумма в валюте и периоде `base`; нет курса — `undefined`. */
export function convertRange(
  range: SourceRange,
  base: { readonly currency: string; readonly period: Period },
  rates: CurrencyRates | undefined,
): Range | undefined {
  const from = PER_YEAR[range.period];
  const to = PER_YEAR[base.period];
  const factor = range.period === base.period ? 1 : from && to ? from / to : undefined;
  if (factor === undefined) return undefined;
  const low = convertAmount(range.low * factor, range.currency, base.currency, rates);
  const high = convertAmount(range.high * factor, range.currency, base.currency, rates);
  return low === undefined || high === undefined ? undefined : { low, high };
}

const keyOf = ({ low, high }: Range): string => `${low}|${high}`;
const viewKey = (range: Range, period: Period): string =>
  keyOf(period === 'year' ? monthlyMarketEstimate({ ...range, period }) : range);

/** Вилка раздвигается на шаг, пока повторяет чью-то; не отличить — оценки нет. */
export function distinctRange(
  range: Range,
  base: { readonly currency: string; readonly period: Period },
  sources: readonly SourceRange[],
  rates: CurrencyRates | undefined,
): Range | undefined {
  const own = new Set<string>();
  const shown = new Set<string>();
  for (const source of sources) {
    const converted = convertRange(source, base, rates);
    if (!converted) continue;
    own.add(keyOf(converted)).add(keyOf(rounded(converted)));
    shown.add(viewKey(converted, base.period)).add(viewKey(rounded(converted), base.period));
  }
  const step = stepOf(range.low);
  for (let shift = 0; shift <= MAX_SHIFTS; shift += 1) {
    const low = roundTo(range.low - Math.floor(shift / 2) * step, step);
    const high = roundTo(range.high + Math.ceil(shift / 2) * step, step);
    const next = { low, high };
    if (low <= 0) return undefined;
    if (!own.has(keyOf(next)) && !shown.has(viewKey(next, base.period))) return next;
  }
  return undefined;
}
