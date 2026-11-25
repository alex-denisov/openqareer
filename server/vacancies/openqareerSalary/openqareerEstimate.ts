/**
 * B803: «Оценка openqareer». Лестница: должность и функция в месте (источники и каталог вместе) →
 * множитель уровня в той же стране → госданные → мир. Каждое число выведено из записей источников.
 */
import type { CurrencyRates } from '../../../shared/currencyRates';
import {
  marketSalaryCity,
  marketSalaryKey,
  type MarketSalaryEstimate,
} from '../../../shared/marketSalaryEstimate';
import { marketSalaryCityPlace } from '../marketSalary/marketSalaryCountry';
import { iscoOfFunction } from '../occupationEarnings/iscoOfFunction';
import type { CountryEarning } from '../occupationEarnings/occupationEarningStore';
import type { BenchmarkLookup } from '../salaryBenchmarks/benchmarkLookup';
import { familyKeyOf, titleKeyOf } from '../salaryBenchmarks/benchmarkRollups';
import {
  blendInputOf,
  blendSalary,
  PER_YEAR,
  roundTo,
  stepOf,
  type BlendInput,
  type BlendResult,
} from '../salaryBenchmarks/blendSalaryBenchmarks';
import { levelRatio } from '../salaryBenchmarks/levelMultipliers';
import {
  BENCHMARK_PRECISIONS,
  catalogPrecision,
  matchSalaryBenchmarks,
  type BenchmarkPrecision,
} from '../salaryBenchmarks/pickSalaryBenchmark';
import {
  GULF_COUNTRIES,
  isCisCountry,
  neighbourCountries,
  regionOfCountry,
} from './neighbourCountries';

export interface EstimateQuery {
  readonly title: string;
  readonly functionCode: string;
  readonly levelRank: number | null;
  readonly location: string | null | undefined;
  readonly country?: string;
}

export interface EstimateDeps {
  readonly catalog: { get(key: string): MarketSalaryEstimate | undefined };
  readonly lookup: BenchmarkLookup;
  readonly earning: (
    country: string,
    isco: string,
    neighbours: readonly string[],
  ) => CountryEarning | undefined;
  readonly rates: CurrencyRates | undefined;
  readonly now: Date;
}

export type EstimateStep = 'direct' | 'level' | 'statistics' | 'world';
export interface EstimateResult extends BlendResult {
  /** Внутренняя пометка: в ответ API не входит. */
  readonly step: EstimateStep;
  /** Рынок соседней страны вместо своего. */
  readonly donor?: boolean;
}

interface Place {
  readonly country: string;
  readonly city?: string;
  readonly region?: string;
}
interface Candidate {
  readonly precision: BenchmarkPrecision;
  readonly inputs: readonly BlendInput[];
  /** Объявлений каталога хватает, чтобы цифра стояла одна. */
  readonly enough?: boolean;
}

const CATALOG_NAME = 'openqareer';
const STATISTICS_NAME = 'open statistics';
/** Обзоры агентств по России выше объявлений в 2–3 раза: от этой выборки верим объявлениям. */
const ENOUGH_ADVERTS = 30;
const MANAGER_RANK = 2;
const VP_RANK = 3;
const CIS_DONOR = 'RU';
const LEVELS = [0, 1, 2, 3, 4] as const;
/** Функция не названа: остаётся средний заработок страны по всем занятиям. */
export const NO_FUNCTION = 'other';

/** Уровни от ближайшего к искомому. */
const levelsFrom = (target: number): number[] =>
  [...LEVELS].sort(
    (left, right) => Math.abs(left - target) - Math.abs(right - target) || left - right,
  );

const monthly = (input: BlendInput): boolean => PER_YEAR[input.period] !== undefined;

function catalogInput(
  estimate: MarketSalaryEstimate | undefined,
  now: Date,
): BlendInput | undefined {
  if (estimate?.low === undefined || estimate.high === undefined || estimate.low <= 0)
    return undefined;
  const currency = estimate.currency === 'RUR' ? 'RUB' : estimate.currency;
  const period = estimate.period ?? (currency === 'RUB' ? 'month' : undefined);
  if (!period) return undefined;
  return {
    kind: 'portal',
    sourceName: CATALOG_NAME,
    low: estimate.low,
    high: estimate.high,
    currency,
    period,
    tax: 'unknown',
    payBase: 'unknown',
    year: now.getUTCFullYear(),
    confidence: 'full',
  };
}

function catalogCandidates(
  query: EstimateQuery,
  levelRank: number | null,
  place: Place,
  deps: EstimateDeps,
): Candidate[] {
  const read = (basis: 'city' | 'country', name: string): Candidate[] => {
    const key = marketSalaryKey(query.functionCode, levelRank, basis, name);
    const estimate = deps.catalog.get(key);
    const input = catalogInput(estimate, deps.now);
    const enough = (estimate?.sampleSize ?? 0) >= ENOUGH_ADVERTS;
    return input ? [{ precision: catalogPrecision(basis), inputs: [input], enough }] : [];
  };
  return [
    ...(place.city ? read('city', marketSalaryCityPlace(place.country, place.city)) : []),
    ...read('country', place.country),
  ];
}

function sourceCandidate(
  query: EstimateQuery,
  levelRank: number | null,
  place: Place,
  deps: EstimateDeps,
): Candidate[] {
  const places = [`country:${place.country}`, ...(place.region ? [`region:${place.region}`] : [])];
  const keys = [
    titleKeyOf(query.title),
    familyKeyOf(query.functionCode, levelRank),
    familyKeyOf(query.functionCode, null),
  ];
  const usable = deps.lookup.rows(places, [...new Set(keys)]).flatMap((row) => {
    const input = blendInputOf(row);
    return input && monthly(input) ? [row] : [];
  });
  const matches = matchSalaryBenchmarks(usable, { ...query, levelRank, ...place });
  const [first] = matches;
  if (!first) return [];
  const inputs = matches.flatMap(({ benchmark }) => blendInputOf(benchmark) ?? []);
  return [{ precision: first.precision, inputs }];
}

/** VP и выше в объявлениях — малые компании: лучшая цифра каталога и источники вместе. */
function catalogWithSources(
  catalog: readonly Candidate[],
  sources: readonly Candidate[],
): Candidate | undefined {
  const own = bestCandidate(catalog);
  const guide = bestCandidate(sources);
  if (!own || !guide) return own ?? guide;
  return { precision: guide.precision, inputs: [...own.inputs, ...guide.inputs] };
}

/** Каталог с достаточной выборкой стоит один; иначе все цифры самой точной ступени. */
function bestCandidate(candidates: readonly Candidate[]): Candidate | undefined {
  const measured = candidates.find(({ enough }) => enough);
  if (measured) return measured;
  const order = ({ precision }: Candidate) => BENCHMARK_PRECISIONS.indexOf(precision);
  const [best] = [...candidates].sort((left, right) => order(left) - order(right));
  return best
    ? {
        precision: best.precision,
        inputs: candidates
          .filter(({ precision }) => precision === best.precision)
          .flatMap(({ inputs }) => inputs),
      }
    : undefined;
}

function blended(
  candidate: Candidate | undefined,
  deps: EstimateDeps,
  step: EstimateStep,
): EstimateResult | undefined {
  if (!candidate) return undefined;
  const result = blendSalary(candidate.inputs, candidate.precision, deps.rates, deps.now);
  return result
    ? { ...result, step, lowConfidence: result.lowConfidence || step !== 'direct' }
    : undefined;
}

const scaled = (input: BlendInput, ratio: number): BlendInput => ({
  ...input,
  low: input.low * ratio,
  high: input.high * ratio,
});

/** Соседний уровень той же функции и страны, приведённый множителем. */
function levelStep(
  query: EstimateQuery,
  place: Place,
  deps: EstimateDeps,
): EstimateResult | undefined {
  const target = query.levelRank ?? 0;
  for (const level of levelsFrom(target)) {
    if (level === target) continue;
    if (GULF_COUNTRIES.has(place.country) && (level === VP_RANK || target === VP_RANK)) continue;
    const ratio = levelRatio(deps.lookup.multipliers, query.functionCode, level, target);
    if (ratio === undefined) continue;
    const sources = sourceCandidate({ ...query, title: '' }, level, place, deps);
    const best = bestCandidate([...catalogCandidates(query, level, place, deps), ...sources]);
    const inputs = best?.inputs.map((input) => scaled(input, ratio));
    const result = best && inputs ? blended({ ...best, inputs }, deps, 'level') : undefined;
    if (result) return result;
  }
  return undefined;
}

/** Группа «руководители» — уровень Head, остальные группы занятий — рядовой. */
function statisticsStep(
  query: EstimateQuery,
  place: Place,
  deps: EstimateDeps,
): EstimateResult | undefined {
  const target = query.levelRank ?? 0;
  const base = target >= MANAGER_RANK ? MANAGER_RANK : 0;
  const ratio = levelRatio(deps.lookup.multipliers, query.functionCode, base, target);
  const isco = iscoOfFunction(query.functionCode, query.levelRank);
  const earning = ratio
    ? deps.earning(place.country, isco, neighbourCountries(place.country))
    : undefined;
  if (!earning || !ratio) return undefined;
  const middle = earning.monthlyUsd * ratio;
  const spread = earning.basis === 'direct' ? 0.2 : 0.3;
  const input: BlendInput = {
    kind: 'gov',
    sourceName: STATISTICS_NAME,
    low: middle * (1 - spread),
    high: middle * (1 + spread),
    currency: 'USD',
    period: 'month',
    tax: 'unknown',
    payBase: 'unknown',
    year: earning.year,
    confidence: 'reduced',
  };
  return blended({ precision: 'family-country', inputs: [input] }, deps, 'statistics');
}

function worldStep(query: EstimateQuery, deps: EstimateDeps): EstimateResult | undefined {
  const target = query.levelRank ?? 0;
  for (const level of levelsFrom(target)) {
    const result = deps.lookup.world(query.functionCode, level);
    const ratio = levelRatio(deps.lookup.multipliers, query.functionCode, level, target);
    if (!result || ratio === undefined) continue;
    const { low, high, ...estimate } = result.estimate;
    const step = stepOf(low * ratio);
    const range = { low: roundTo(low * ratio, step), high: roundTo(high * ratio, step) };
    return { ...result, estimate: { ...estimate, ...range }, step: 'world' };
  }
  return undefined;
}

export function openqareerEstimate(
  query: EstimateQuery,
  deps: EstimateDeps,
): EstimateResult | undefined {
  const { country } = query;
  if (!country) return worldStep(query, deps);
  const own = placeEstimate(query, country, deps);
  if (own) return own;
  // Мир завышает СНГ в 6–8 раз; рынок России ближе.
  const near = isCisCountry(country)
    ? placeEstimate({ ...query, location: undefined }, CIS_DONOR, deps)
    : undefined;
  return near ? { ...near, lowConfidence: true, donor: true } : worldStep(query, deps);
}

function placeEstimate(
  query: EstimateQuery,
  country: string,
  deps: EstimateDeps,
): EstimateResult | undefined {
  const place: Place = {
    country,
    city: marketSalaryCity(query.location),
    region: regionOfCountry(country),
  };
  if (query.functionCode === NO_FUNCTION) {
    const named = sourceCandidate(query, query.levelRank, place, deps).filter(({ precision }) =>
      precision.startsWith('role-'),
    );
    return blended(bestCandidate(named), deps, 'direct') ?? statisticsStep(query, place, deps);
  }
  const catalog = catalogCandidates(query, query.levelRank, place, deps);
  const sources = sourceCandidate(query, query.levelRank, place, deps);
  const direct =
    (query.levelRank ?? 0) >= VP_RANK
      ? catalogWithSources(catalog, sources)
      : bestCandidate([...catalog, ...sources]);
  return (
    blended(direct, deps, 'direct') ??
    levelStep(query, place, deps) ??
    statisticsStep(query, place, deps)
  );
}
