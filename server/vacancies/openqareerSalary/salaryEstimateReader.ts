/** B803: оценка вакансии без зарплаты для списка, карточки и порядка «Деньги». Только чтение по ключам. */
import { DatabaseSync } from 'node:sqlite';
import {
  monthlyMarketEstimate,
  type MarketSalaryEstimateView,
} from '../../../shared/marketSalaryEstimate';
import { getCurrencyRates } from '../../currency/cbrRates';
import { applySqliteBusyTimeout } from '../../data/sqliteBusyTimeout';
import type { VacancyCluster } from '../../domain/unifiedVacancy';
import { marketSalaryCountry } from '../marketSalary/marketSalaryCountry';
import { SqliteMarketSalaryEstimateStore } from '../marketSalary/sqliteMarketSalaryEstimateStore';
import { countryEarning } from '../occupationEarnings/occupationEarningStore';
import { createBenchmarkLookup } from '../salaryBenchmarks/benchmarkLookup';
import { rulesParse } from '../titleParse/rulesParse';
import { normalizeTitleKey } from '../titleParse/normalizeTitleKey';
import { createCities } from '../vacancyCountry/cityCountry';
import { sqliteCities, sqliteEmployerCountry } from '../vacancyCountry/sqliteCities';
import {
  employerKey,
  vacancyCountryHint,
  type CountryHintDeps,
} from '../vacancyCountry/vacancyCountryHint';
import {
  NO_FUNCTION,
  openqareerEstimate,
  type EstimateDeps,
  type EstimateResult,
} from './openqareerEstimate';

export type EstimateCluster = Pick<VacancyCluster, 'canonicalTitle'> &
  Partial<
    Pick<
      VacancyCluster,
      'canonicalLocation' | 'canonicalCompany' | 'primaryUrl' | 'descriptionSummary'
    >
  > & { readonly sources?: readonly { readonly sourceUrl?: string }[] };

export interface TitleFunctions {
  readonly functions: readonly string[];
  readonly levelRank: number | null;
}
export type ReadTitle = (titleKey: string) => TitleFunctions | undefined;

export interface SalaryEstimateReader {
  estimate(cluster: EstimateCluster, readTitle: ReadTitle): MarketSalaryEstimateView | undefined;
}

const CACHE_LIMIT = 20_000;
const CACHE_MS = 10 * 60_000;

/** Функция и уровень — из правил разбора; сохранённый разбор только там, где правила молчат. */
export function titleFunction(title: string, readTitle: ReadTitle) {
  const rules = rulesParse(title);
  const known = (codes: readonly string[]) => codes.find((code) => code !== 'other');
  const byRules = known(rules.functions);
  if (byRules) return { functionCode: byRules, levelRank: rules.levelRank };
  const stored = readTitle(normalizeTitleKey(title));
  const functionCode = known(stored?.functions ?? []);
  return {
    functionCode: functionCode ?? NO_FUNCTION,
    levelRank: rules.levelRank ?? stored?.levelRank ?? null,
  };
}

/** Мир по объявлениям на русском завышал впятеро: такой найм платит по рынку России и соседей. */
const RUSSIAN_TITLE = /^(?!.*[іїєґў]).*[а-яё]{3}/iu;

export function vacancyCountry(
  cluster: EstimateCluster,
  deps: CountryHintDeps,
): string | undefined {
  const urls = [
    cluster.primaryUrl,
    ...(cluster.sources ?? []).map(({ sourceUrl }) => sourceUrl),
  ].filter((url) => url !== undefined);
  return (
    deps.resolvePlace(cluster.canonicalLocation ?? '') ??
    vacancyCountryHint(
      {
        location: cluster.canonicalLocation,
        company: cluster.canonicalCompany ?? '',
        urls,
        text: cluster.descriptionSummary,
      },
      deps,
    )?.country ??
    (RUSSIAN_TITLE.test(cluster.canonicalTitle) ? 'RU' : undefined)
  );
}

export function estimateResult(
  cluster: EstimateCluster,
  readTitle: ReadTitle,
  deps: EstimateDeps,
  hint: CountryHintDeps,
): EstimateResult | undefined {
  const title = titleFunction(cluster.canonicalTitle, readTitle);
  return openqareerEstimate(
    {
      ...title,
      title: cluster.canonicalTitle,
      location: cluster.canonicalLocation,
      country: vacancyCountry(cluster, hint),
    },
    deps,
  );
}

/** Наружу — только диапазон в месяц, валюта, налог и дата. */
export function estimateView(result: EstimateResult): MarketSalaryEstimateView {
  const { low, high, currency, period, tax, computedAt } = result.estimate;
  const month = monthlyMarketEstimate({
    low,
    high,
    currency,
    period: period === 'year' ? 'year' : 'month',
  });
  return { ...month, tax, computedAt };
}

export type SalaryEstimator = (
  cluster: EstimateCluster,
  readTitle: ReadTitle,
  rates: EstimateDeps['rates'],
  now: Date,
) => EstimateResult | undefined;

/** Единственная сборка модуля подбора: веб, обслуживание и анкеты считают одинаково. */
export function createSalaryEstimator(database: DatabaseSync): SalaryEstimator {
  const employer = sqliteEmployerCountry(database);
  const deps = {
    catalog: new SqliteMarketSalaryEstimateStore({ database }),
    lookup: createBenchmarkLookup(database),
    earning: (country: string, isco: string, neighbours: readonly string[]) =>
      countryEarning(database, country, isco, neighbours),
  };
  const hint: CountryHintDeps = {
    resolvePlace: marketSalaryCountry,
    cities: createCities(sqliteCities(database)),
    employerCountry: (company) => employer(employerKey(company)),
  };
  return (cluster, readTitle, rates, now) =>
    estimateResult(cluster, readTitle, { ...deps, rates, now }, hint);
}

export class SqliteSalaryEstimateReader implements SalaryEstimateReader {
  private readonly database: DatabaseSync;
  private readonly estimator: SalaryEstimator;
  private cache = new Map<string, MarketSalaryEstimateView | undefined>();
  private cachedAt = 0;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    applySqliteBusyTimeout(this.database);
    this.estimator = createSalaryEstimator(this.database);
  }

  estimate(cluster: EstimateCluster, readTitle: ReadTitle): MarketSalaryEstimateView | undefined {
    const now = Date.now();
    if (now - this.cachedAt > CACHE_MS || this.cache.size >= CACHE_LIMIT) {
      this.cache = new Map();
      this.cachedAt = now;
    }
    const { canonicalTitle, canonicalLocation, canonicalCompany, primaryUrl } = cluster;
    const key = JSON.stringify([canonicalTitle, canonicalLocation, canonicalCompany, primaryUrl]);
    if (this.cache.has(key)) return this.cache.get(key);
    const result = this.estimator(cluster, readTitle, getCurrencyRates(), new Date(now));
    const view = result ? estimateView(result) : undefined;
    this.cache.set(key, view);
    return view;
  }

  close(): void {
    this.database.close();
  }
}
