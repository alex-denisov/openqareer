/**
 * B803: последняя ступень — место неизвестно. Диапазон по странам, где эта функция и уровень есть в
 * записях: ни одного числа, которого не было бы в источниках, и без одной страны-победителя.
 */
import { convertAmount, type CurrencyRates } from '../../../shared/currencyRates';
import {
  blendInputOf,
  oneKind,
  PER_YEAR,
  roundTo,
  stepOf,
  type BlendResult,
} from './blendSalaryBenchmarks';
import type { SalaryBenchmark } from './salaryBenchmark';

const CURRENCY = 'USD';
const MONTHS = 12;
/** Меньше трёх стран — это не мир. */
const MIN_COUNTRIES = 3;
const LOW_SHARE = 0.25;
const HIGH_SHARE = 0.75;

interface CountryRange {
  readonly low: number;
  readonly high: number;
}

function quantile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (sorted.length - 1) * share;
  const below = sorted[Math.floor(at)] ?? 0;
  return below + ((sorted[Math.ceil(at)] ?? below) - below) * (at - Math.floor(at));
}

function monthlyUsd(
  row: SalaryBenchmark,
  rates: CurrencyRates | undefined,
): CountryRange | undefined {
  const input = blendInputOf(row);
  const perYear = PER_YEAR[row.period];
  if (!input || !perYear) return undefined;
  const convert = (amount: number) =>
    convertAmount((amount * perYear) / MONTHS, input.currency, CURRENCY, rates);
  const low = convert(input.low);
  const high = convert(input.high);
  return low === undefined || high === undefined ? undefined : { low, high };
}

/** Страна голосует один раз: медиана её строк. */
function countryRanges(
  rows: readonly SalaryBenchmark[],
  rates: CurrencyRates | undefined,
): CountryRange[] {
  const byCountry = new Map<string, CountryRange[]>();
  for (const row of rows) {
    const range = row.country ? monthlyUsd(row, rates) : undefined;
    if (!row.country || !range) continue;
    byCountry.set(row.country, [...(byCountry.get(row.country) ?? []), range]);
  }
  return [...byCountry.values()].map((ranges) => ({
    low: quantile(
      ranges.map(({ low }) => low),
      0.5,
    ),
    high: quantile(
      ranges.map(({ high }) => high),
      0.5,
    ),
  }));
}

export function worldSalaryEstimate(
  rows: readonly SalaryBenchmark[],
  query: { readonly functionCode: string; readonly levelRank: number | null },
  rates: CurrencyRates | undefined,
  now: Date,
): BlendResult | undefined {
  const family = rows.filter(
    (row) => row.functionCode === query.functionCode && row.levelRank === (query.levelRank ?? 0),
  );
  const kept = oneKind(
    oneKind(family, (row) => row.payBase, 'base'),
    (row) => row.tax,
  );
  const ranges = countryRanges(kept, rates);
  if (ranges.length < MIN_COUNTRIES) return undefined;
  const low = quantile(
    ranges.map((range) => range.low),
    LOW_SHARE,
  );
  const high = quantile(
    ranges.map((range) => range.high),
    HIGH_SHARE,
  );
  const step = stepOf(low);
  return {
    estimate: {
      low: roundTo(low, step),
      high: roundTo(high, step),
      currency: CURRENCY,
      period: 'month',
      tax: kept.find(({ tax }) => tax !== 'unknown')?.tax ?? 'unknown',
      computedAt: now.toISOString(),
    },
    precision: 'family-world',
    lowConfidence: true,
  };
}
