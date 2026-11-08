/**
 * SEO P2: country salary figure from the open catalog. The labels the catalog
 * already stores («120 000 — 160 000 $») are parsed by the listing parser; only
 * «от — до» ranges count. Labels carry no period, so the period is read from
 * the size of the midpoint in its currency, and only the dominant
 * currency+period group is published. Below MIN_COUNTRY_POOL_SAMPLE ranges the
 * figure is absent (the page says so and is not indexed when it has nothing else).
 */
import { parseSalaryLabel } from '../vacancies/catalogSalaryStats';
import {
  MIN_COUNTRY_POOL_SAMPLE,
  type CountryPoolPay,
  type PoolPayPeriod,
} from '../../shared/salaryCountryCities';

/** A monthly figure in these currencies above this value is a yearly salary. */
const YEARLY_FROM: Readonly<Record<string, number>> = { $: 15_000, '€': 15_000, '£': 15_000 };

function periodOf(sign: string, mid: number): PoolPayPeriod {
  const limit = YEARLY_FROM[sign];
  return limit !== undefined && mid >= limit ? 'year' : 'month';
}

function quantile(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function roundFigure(value: number): number {
  return value >= 10_000 ? Math.round(value / 1000) * 1000 : Math.round(value);
}

export function countryPoolPay(
  labels: readonly string[],
  readAt: string,
  sources: readonly string[] = [],
): CountryPoolPay | undefined {
  const groups = new Map<string, number[]>();
  let withSalary = 0;
  for (const label of labels) {
    const parsed = parseSalaryLabel(label);
    if (!parsed) continue;
    withSalary += 1;
    if (parsed.from === undefined || parsed.to === undefined || parsed.from >= parsed.to) continue;
    const mid = (parsed.from + parsed.to) / 2;
    const key = `${parsed.sign}|${periodOf(parsed.sign, mid)}`;
    groups.set(key, [...(groups.get(key) ?? []), mid]);
  }
  const best = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!best || best[1].length < MIN_COUNTRY_POOL_SAMPLE) return undefined;
  const [sign, period] = best[0].split('|') as [string, PoolPayPeriod];
  const sorted = [...best[1]].sort((a, b) => a - b);
  return {
    median: roundFigure(quantile(sorted, 0.5)),
    low: roundFigure(quantile(sorted, 0.25)),
    high: roundFigure(quantile(sorted, 0.75)),
    sign,
    period,
    sampleSize: sorted.length,
    withSalary,
    readAt,
    sources: [...new Set(sources.filter(Boolean))].sort().slice(0, 5),
  };
}
