/**
 * B569, revised 09.11: salary facts for a catalog list. Labels («120 000 —
 * 140 000 ₽») carry no period, so a yearly, a monthly and an hourly range used to
 * meet in one median. Now `withSalary` still counts labels, but ranges come only
 * from the stored salary whose period the source stated (Lever interval,
 * Himalayas salaryPeriod, hh MONTH — `parseSalaryRangeEvidence`), one group per
 * currency × period. A group below MIN_RANGES is dropped; no group, no figure.
 */
import { normalizeSalaryLabel } from './catalogCopy';

/** Fewer ranges than this is an anecdote, not a market figure. */
export const MIN_RANGES = 5;

export interface ParsedSalary {
  readonly from?: number;
  readonly to?: number;
  readonly sign: string;
}

export type SalaryPeriod = 'hour' | 'month' | 'year';

/** One currency × period group of period-proven ranges. */
export interface SalaryGroup {
  readonly currency: string;
  readonly period: SalaryPeriod;
  readonly sample: number;
  /** Median of range midpoints; low/high are its quartiles. */
  readonly median: number;
  readonly low: number;
  readonly high: number;
}

export interface ProvenRange {
  readonly from: number;
  readonly to: number;
  readonly currency: string;
  readonly period: SalaryPeriod;
}

export interface SalaryStats {
  /** Vacancies of the list that state any salary. */
  readonly withSalary: number;
  /** Ranges «от — до» whose period the source stated. */
  readonly withRange: number;
  /** Groups with at least MIN_RANGES ranges, largest first; absent when none. */
  readonly groups?: readonly SalaryGroup[];
  /** The role of the list has its own /salaries/<role> page (B569). */
  readonly salaryPage?: boolean;
}

function amount(text: string): number | undefined {
  const digits = text.replace(/[^\d]/gu, '');
  return digits ? Number.parseInt(digits, 10) : undefined;
}

/** Currency marks a list may show; anything else in a label is not a salary sign. */
const SALARY_SIGNS: ReadonlySet<string> = new Set(['₽', '$', '€', '£', '₸', '₴', '₾', '₼', 'Br']);

export function parseSalaryLabel(raw: string): ParsedSalary | undefined {
  const label = normalizeSalaryLabel(raw).trim();
  const tail = /\s(\S+)$/u.exec(label);
  const sign = tail && !/\d/u.test(tail[1]!) ? tail[1]! : '';
  if (sign && !SALARY_SIGNS.has(sign)) return undefined;
  const body = sign ? label.slice(0, label.length - sign.length) : label;
  const range = /^([\d\s\u00a0\u202f]+)—([\d\s\u00a0\u202f]+)$/u.exec(body.trim());
  if (range) {
    const from = amount(range[1]!);
    const to = amount(range[2]!);
    return from !== undefined && to !== undefined ? { from, to, sign } : undefined;
  }
  const value = amount(body);
  if (value === undefined) return undefined;
  return /^до/u.test(body.trim()) ? { to: value, sign } : { from: value, sign };
}

function quantile(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return Math.round(sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower));
}

/** «150 125 ₽» reads as false precision; list figures show whole thousands. */
function roundFigure(value: number): number {
  return value >= 10_000 ? Math.round(value / 1000) * 1000 : Math.round(value);
}

function group(currency: string, period: SalaryPeriod, mids: number[]): SalaryGroup {
  const sorted = [...mids].sort((a, b) => a - b);
  return {
    currency,
    period,
    sample: sorted.length,
    median: roundFigure(quantile(sorted, 0.5)),
    low: roundFigure(quantile(sorted, 0.25)),
    high: roundFigure(quantile(sorted, 0.75)),
  };
}

export function salaryStats(withSalary: number, ranges: readonly ProvenRange[]): SalaryStats {
  const real = ranges.filter((r) => r.to > r.from);
  const byKey = new Map<string, number[]>();
  for (const r of real) {
    const key = `${r.currency}|${r.period}`;
    byKey.set(key, [...(byKey.get(key) ?? []), (r.from + r.to) / 2]);
  }
  const groups = [...byKey.entries()]
    .filter(([, mids]) => mids.length >= MIN_RANGES)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, mids]) => {
      const [currency, period] = key.split('|') as [string, SalaryPeriod];
      return group(currency, period, mids);
    });
  const base = { withSalary, withRange: real.length };
  return groups.length ? { ...base, groups } : base;
}
