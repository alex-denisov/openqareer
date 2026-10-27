/**
 * B569: salary facts for a catalog list, counted from the salary labels the
 * list already stores. No numeric salary column exists in the projection, so
 * the label («120 000 — 140 000 ₽», «от 60 000 ₽», «до 90 000 ₽», «30 000 ₽») is
 * parsed here. Only ranges «от — до» in one currency enter the median; a list
 * with fewer than MIN_RANGES of them gets counts but no median (no invented
 * numbers).
 */
import { normalizeSalaryLabel } from './catalogCopy';

/** Fewer ranges than this is an anecdote, not a market figure. */
export const MIN_RANGES = 5;

export interface ParsedSalary {
  readonly from?: number;
  readonly to?: number;
  readonly sign: string;
}

export interface SalaryStats {
  /** Vacancies of the list that state any salary. */
  readonly withSalary: number;
  /** Of them, with both ends «от — до». */
  readonly withRange: number;
  /** Median of range midpoints, in `sign`; absent when ranges are too few. */
  readonly median?: number;
  readonly low?: number;
  readonly high?: number;
  readonly sign?: string;
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

export function salaryStats(labels: readonly string[]): SalaryStats {
  const parsed = labels.map(parseSalaryLabel).filter((p): p is ParsedSalary => p !== undefined);
  const ranges = parsed.filter(
    (p) => p.from !== undefined && p.to !== undefined && p.from !== p.to,
  );
  const base = { withSalary: parsed.length, withRange: ranges.length };
  const bySign = new Map<string, number[]>();
  for (const p of ranges) {
    bySign.set(p.sign, [...(bySign.get(p.sign) ?? []), (p.from! + p.to!) / 2]);
  }
  const [sign, mids] = [...bySign.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  if (!mids || mids.length < MIN_RANGES) return base;
  const sorted = [...mids].sort((a, b) => a - b);
  return {
    ...base,
    median: roundFigure(quantile(sorted, 0.5)),
    low: roundFigure(quantile(sorted, 0.25)),
    high: roundFigure(quantile(sorted, 0.75)),
    sign: sign ?? '',
  };
}
