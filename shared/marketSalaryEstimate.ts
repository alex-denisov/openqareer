/**
 * B546: market salary estimate for vacancies that state no salary.
 *
 * The maintenance process groups salaried vacancies of the same normalised
 * function and level by city and by region; the estimate is the
 * interquartile range (p25–p75) of the salary midpoints. Below
 * `MARKET_SALARY_MIN_SAMPLE` vacancies there is no number, only the sample
 * size, so the screen says «мало данных» instead of inventing a range.
 *
 * There is no exchange-rate source in the system, so samples are never
 * converted: a group keeps its dominant currency and other currencies are
 * left out of it.
 */
import { pluralWordRu } from './pluralRu';
import { normalizeCityLabel } from './cityLabel';
import { isCountryName } from './placeNames';

export const MARKET_SALARY_MIN_SAMPLE = 5;
/** Below this a stated amount is an hourly rate, not a monthly or yearly salary. */
const MIN_PERIOD_SALARY = 1_000;

export interface MarketSalaryEstimate {
  /** Absent when the sample is below the minimum: no number is shown. */
  readonly low?: number;
  readonly high?: number;
  readonly currency: string;
  readonly sampleSize: number;
}

export type MarketSalaryBasis = 'city' | 'region';

/** What the matched-vacancies response carries for a vacancy without salary. */
export interface MarketSalaryEstimateView extends MarketSalaryEstimate {
  readonly basis: MarketSalaryBasis;
  /** ISO time of the batch that computed the estimate: the date of the cut. */
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

export function estimateFromMidpoints(
  midpoints: readonly number[],
  currency: string,
): MarketSalaryEstimate {
  const sampleSize = midpoints.length;
  if (sampleSize < MARKET_SALARY_MIN_SAMPLE) return { currency, sampleSize };
  const sorted = [...midpoints].sort((left, right) => left - right);
  const p25 = quantile(sorted, 0.25);
  const p75 = quantile(sorted, 0.75);
  // Ten thousand is the step for monthly roubles and yearly dollars; a monthly
  // euro salary of 6 000 would round to zero, so small amounts use a thousand.
  const step = p75 >= 100_000 ? 10_000 : 1_000;
  return { low: roundEstimate(p25, step), high: roundEstimate(p75, step), currency, sampleSize };
}

function hasNumber(estimate: MarketSalaryEstimate | undefined): boolean {
  return estimate?.low !== undefined && estimate.high !== undefined;
}

/** City first; the region when the city has no number; otherwise the larger thin sample. */
export function pickMarketSalaryEstimate(
  city: MarketSalaryEstimate | undefined,
  region: MarketSalaryEstimate | undefined,
): (MarketSalaryEstimate & { readonly basis: MarketSalaryBasis }) | undefined {
  if (city && hasNumber(city)) return { ...city, basis: 'city' };
  if (region && hasNumber(region)) return { ...region, basis: 'region' };
  if (city && (!region || city.sampleSize >= region.sampleSize)) return { ...city, basis: 'city' };
  return region ? { ...region, basis: 'region' } : undefined;
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
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value / 1_000);
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

/** «по 41 вакансии, 05.10» — sample size and the date of the cut. */
export function marketSalaryBasis(sampleSize: number, computedAt: string): string {
  const word = pluralWordRu(sampleSize, ['вакансии', 'вакансиям', 'вакансиям']);
  const date = cutDate(computedAt);
  return `по ${sampleSize} ${word}${date ? `, ${date}` : ''}`;
}
