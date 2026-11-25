/**
 * B546: market salary estimate for vacancies that state no salary.
 *
 * The maintenance process groups salaried vacancies of the same normalised
 * function and level by city and by country; the estimate is the
 * interquartile range (p25–p75) of the salary midpoints. Below
 * `MARKET_SALARY_MIN_SAMPLE` vacancies there is no number, only the sample
 * size, so the screen says «мало данных» instead of inventing a range.
 *
 * There is no exchange-rate source in the system, so samples are never
 * converted: a group keeps its dominant currency and other currencies are
 * left out of it. Its dominant period wins the same way (B803).
 */
import { normalizeCityLabel } from './cityLabel';
import { isCountryName } from './placeNames';

export const MARKET_SALARY_MIN_SAMPLE = 5;
/** Below this a stated amount is an hourly rate, not a monthly or yearly salary. */
const MIN_PERIOD_SALARY = 1_000;
const MONTHS = 12;
/** Ниже — шаг сотня и знак после запятой: «€4,2–4,4 тыс.», не «€4–4 тыс.». */
const DECIMAL_BELOW = 20_000;

export interface MarketSalaryEstimate {
  /** Absent when the sample is below the minimum: no number is shown. */
  readonly low?: number;
  readonly high?: number;
  readonly currency: string;
  /** B803: суммы разных периодов не смешиваются; нет у строк, посчитанных раньше. */
  readonly period?: MarketSalaryPeriod;
  readonly sampleSize: number;
}

export type MarketSalaryPeriod = 'month' | 'year';

export type MarketSalaryBasis = 'city' | 'country';

/**
 * B803: «Оценка openqareer» у вакансии без зарплаты, в месяц. Источники, выборка и ступень остаются
 * на сервере.
 */
export interface MarketSalaryEstimateView {
  readonly low: number;
  readonly high: number;
  readonly currency: string;
  readonly period: MarketSalaryPeriod;
  readonly tax: 'gross' | 'net' | 'unknown';
  /** ISO time of the computation: the date the screen shows. */
  readonly computedAt: string;
}

export function salaryMidpoint(salary: {
  readonly from?: number | null;
  readonly to?: number | null;
}): number | undefined {
  const from = typeof salary.from === 'number' && salary.from > 0 ? salary.from : undefined;
  const to = typeof salary.to === 'number' && salary.to > 0 ? salary.to : undefined;
  const midpoint = from !== undefined && to !== undefined ? (from + to) / 2 : (from ?? to);
  // Hourly rates (USD 25–60) would drag a monthly or yearly range to zero.
  return midpoint !== undefined && midpoint >= MIN_PERIOD_SALARY ? midpoint : undefined;
}

function quantile(sorted: readonly number[], share: number): number {
  const position = (sorted.length - 1) * share;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const below = sorted[lower] ?? 0;
  const above = sorted[upper] ?? below;
  return below + (above - below) * (position - lower);
}

function roundEstimate(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function estimateStep(low: number, high: number): number {
  if (low >= 50_000 && high >= 100_000) return 10_000;
  return low >= DECIMAL_BELOW ? 1_000 : 100;
}

/**
 * Колонка «Деньги» — в месяц (B765): годовая оценка делится на 12 один раз, на сервере, и все
 * экраны, фильтр и порядок получают месячную сумму.
 */
export function monthlyMarketEstimate<
  T extends { readonly low: number; readonly high: number; readonly period: MarketSalaryPeriod },
>(estimate: T): T {
  if (estimate.period !== 'year') return estimate;
  const low = estimate.low / MONTHS;
  const high = estimate.high / MONTHS;
  const step = estimateStep(low, high);
  return {
    ...estimate,
    low: roundEstimate(low, step),
    high: roundEstimate(high, step),
    period: 'month',
  };
}

export function estimateFromMidpoints(
  midpoints: readonly number[],
  currency: string,
  period?: MarketSalaryPeriod,
): MarketSalaryEstimate {
  const sampleSize = midpoints.length;
  const group = { currency, ...(period ? { period } : {}), sampleSize };
  if (sampleSize < MARKET_SALARY_MIN_SAMPLE) return group;
  const sorted = [...midpoints].sort((left, right) => left - right);
  const p25 = quantile(sorted, 0.25);
  const p75 = quantile(sorted, 0.75);
  // Ten thousand is the step for monthly roubles and yearly dollars; a monthly
  // euro salary of 6 000 would round to zero, so small amounts use a smaller one.
  const step = estimateStep(p25, p75);
  return { low: roundEstimate(p25, step), high: roundEstimate(p75, step), ...group };
}

export function marketSalaryKey(
  functionCode: string,
  levelRank: number | null | undefined,
  basis: MarketSalaryBasis,
  place: string,
): string {
  const level = levelRank === null || levelRank === undefined ? '-' : String(levelRank);
  return `${functionCode}|${level}|${basis}|${place.trim().toLocaleLowerCase('ru-RU')}`;
}

/**
 * The city of a free-text location: «Москва, Россия» → «Москва». The same
 * label the map uses (A9): «London EC1V 8AB» and «London EC1M» are one London
 * group, and «Remote» or a country is no city at all.
 */
export function marketSalaryCity(location: string | null | undefined): string | undefined {
  const first = location?.split(/[;,/]/u)[0]?.trim();
  const city = first ? normalizeCityLabel(first) : undefined;
  return city && !isCountryName(city) ? city : undefined;
}

const CURRENCY_SIGN: Readonly<Record<string, string>> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
};

function thousands(value: number): string {
  const maximumFractionDigits = value < DECIMAL_BELOW ? 1 : 0;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits }).format(value / 1_000);
}

/** «≈ 480–560 тыс. ₽», «≈ $150–190 тыс.» */
export function formatMarketSalaryRange(estimate: {
  readonly low: number;
  readonly high: number;
  readonly currency: string;
}): string {
  const code = estimate.currency.toUpperCase();
  const range = `${thousands(estimate.low)}–${thousands(estimate.high)}`;
  if (code === 'RUR' || code === 'RUB') return `≈ ${range} тыс. ₽`;
  const sign = CURRENCY_SIGN[code];
  return sign ? `≈ ${sign}${range} тыс.` : `≈ ${range} тыс. ${code}`;
}

function cutDate(iso: string): string | undefined {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(date);
}

/** «Оценка openqareer, 05.10»: источники не показываем, дата расчёта есть всегда. */
export function marketSalaryLabel(computedAt: string): string {
  const date = cutDate(computedAt);
  return date ? `Оценка openqareer, ${date}` : 'Оценка openqareer';
}
