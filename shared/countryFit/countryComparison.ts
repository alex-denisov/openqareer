export type EvidenceKind = 'official' | 'vacancy_catalog' | 'candidate_profile' | 'calculation';

export interface ComparisonEvidence {
  readonly kind: EvidenceKind;
  readonly title: string;
  readonly url?: string;
  readonly dataYear?: number;
  readonly capturedAt: string;
  readonly sampleSize?: number;
}

export interface ParetoObservation {
  readonly dimension: string;
  readonly value: number | 'available' | 'high_barriers' | 'legally_unavailable';
  readonly direction: 'higher' | 'lower';
  readonly basisKey: string;
  readonly unit: string;
}

export type CountryComparisonFact<T> =
  | {
      readonly status: 'available';
      readonly value: T;
      readonly sources: readonly ComparisonEvidence[];
      readonly pareto?: ParetoObservation;
    }
  | { readonly status: 'no_data' | 'unknown'; readonly reason: string };

export interface VacancyComparisonValue {
  readonly count: number;
  readonly sampleSize: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly scope: string;
}

export interface MoneyComparisonValue {
  readonly amount: number;
  readonly currency: string;
  readonly basis: string;
}

export interface CountryComparisonCountry {
  readonly countryCode: string;
  readonly countryName: string;
  readonly facts: {
    readonly access: CountryComparisonFact<{
      readonly label: string;
      readonly status: 'available' | 'high_barriers' | 'legally_unavailable';
    }>;
    readonly processingTime: CountryComparisonFact<{
      readonly amount: number;
      readonly unit: 'days' | 'weeks';
      readonly basis: string;
    }>;
    readonly relocationVacancies: CountryComparisonFact<VacancyComparisonValue>;
    readonly salaryThreshold: CountryComparisonFact<{
      readonly amount: number;
      readonly currency: string;
      readonly basis: string;
    }>;
    readonly incomeTax: CountryComparisonFact<{
      readonly effectiveRate: number;
      readonly basis: string;
    }>;
    readonly netIncome: CountryComparisonFact<MoneyComparisonValue>;
    readonly monthlyRemainder: CountryComparisonFact<MoneyComparisonValue>;
    readonly workingLanguage: CountryComparisonFact<{ readonly summary: string }>;
    readonly familyAndResidence: CountryComparisonFact<{ readonly summary: string }>;
  };
}

export interface ParetoResult {
  readonly status: 'ready' | 'insufficient_data';
  readonly dimensions: readonly string[];
  readonly frontierCountryCodes: readonly string[];
  readonly dominated: readonly {
    readonly countryCode: string;
    readonly byCountryCodes: readonly string[];
  }[];
  readonly reason: string | null;
}

type MatrixMetric =
  | 'access'
  | 'processingTime'
  | 'relocationVacancies'
  | 'salaryThreshold'
  | 'incomeTax'
  | 'netIncome'
  | 'monthlyRemainder'
  | 'workingLanguage'
  | 'familyAndResidence';
type MetricKind = 'numeric' | 'access';

interface NormalizedMetric {
  readonly id: MatrixMetric;
  readonly basisKey: string;
  readonly unit: string;
  readonly direction: 'higher' | 'lower';
  readonly kind: MetricKind;
}

const METRIC_IDS: readonly MatrixMetric[] = [
  'access',
  'processingTime',
  'relocationVacancies',
  'salaryThreshold',
  'incomeTax',
  'netIncome',
  'monthlyRemainder',
];

export function calculateParetoFrontier(
  countries: readonly CountryComparisonCountry[],
): ParetoResult {
  if (countries.length < 2) return insufficient('Для сравнения нужны минимум две страны.');

  const dimensions = commonDimensions(countries);
  if (dimensions.length < 2) {
    return insufficient(
      'Для границы Парето нужны минимум две общие сопоставимые метрики с источниками.',
    );
  }

  const dominators = new Map<string, string[]>();
  for (const country of countries) dominators.set(country.countryCode, []);

  for (const candidate of countries) {
    for (const alternative of countries) {
      if (candidate.countryCode === alternative.countryCode) continue;
      if (dominates(alternative, candidate, dimensions)) {
        dominators.get(candidate.countryCode)?.push(alternative.countryCode);
      }
    }
  }

  const dominated = countries.flatMap((country) => {
    const byCountryCodes = dominators.get(country.countryCode) ?? [];
    return byCountryCodes.length ? [{ countryCode: country.countryCode, byCountryCodes }] : [];
  });
  return {
    status: 'ready',
    dimensions: dimensions.map(({ id }) => id),
    frontierCountryCodes: countries
      .filter((country) => (dominators.get(country.countryCode) ?? []).length === 0)
      .map(({ countryCode }) => countryCode),
    dominated,
    reason: null,
  };
}

function commonDimensions(countries: readonly CountryComparisonCountry[]): NormalizedMetric[] {
  return METRIC_IDS.flatMap((id) => {
    const observations = countries.map((country) => observationFor(country, id));
    if (observations.some((observation) => observation === null)) return [];
    const [first, ...rest] = observations as NormalizedMetric[];
    return rest.every(
      (item) =>
        item.basisKey === first.basisKey &&
        item.unit === first.unit &&
        item.direction === first.direction &&
        item.kind === first.kind,
    )
      ? [first]
      : [];
  });
}

function observationFor(
  country: CountryComparisonCountry,
  id: MatrixMetric,
): NormalizedMetric | null {
  const fact = country.facts[id] as CountryComparisonFact<unknown>;
  if (!isSourcedFact(fact) || !fact.pareto) return null;
  if (fact.pareto.dimension !== id) return null;
  if (!fact.pareto.basisKey.trim() || !fact.pareto.unit.trim()) return null;
  if (fact.pareto.direction !== 'higher' && fact.pareto.direction !== 'lower') return null;
  if (typeof fact.pareto.value === 'number' && !Number.isFinite(fact.pareto.value)) return null;
  if (
    id === 'access' &&
    !['available', 'high_barriers', 'legally_unavailable'].includes(String(fact.pareto.value))
  )
    return null;
  if (id !== 'access' && typeof fact.pareto.value !== 'number') return null;
  if (!matchesFactValue(country, id, fact.pareto.value)) return null;
  return {
    id,
    basisKey: fact.pareto.basisKey,
    unit: fact.pareto.unit,
    direction: fact.pareto.direction,
    kind: typeof fact.pareto.value === 'number' ? 'numeric' : 'access',
  };
}

function dominates(
  candidate: CountryComparisonCountry,
  other: CountryComparisonCountry,
  dimensions: readonly NormalizedMetric[],
): boolean {
  let strictlyBetter = false;
  for (const dimension of dimensions) {
    const candidateValue = metricValue(candidate, dimension.id);
    const otherValue = metricValue(other, dimension.id);
    if (candidateValue === null || otherValue === null) return false;
    const comparison = compareValues(candidateValue, otherValue, dimension);
    if (comparison < 0) return false;
    if (comparison > 0) strictlyBetter = true;
  }
  return strictlyBetter;
}

function metricValue(country: CountryComparisonCountry, id: MatrixMetric): number | string | null {
  const fact = country.facts[id] as CountryComparisonFact<unknown>;
  if (!isSourcedFact(fact) || !fact.pareto) return null;
  return fact.pareto.value;
}

function compareValues(
  left: number | string,
  right: number | string,
  dimension: NormalizedMetric,
): number {
  const leftValue = normalizedValue(left, dimension);
  const rightValue = normalizedValue(right, dimension);
  const relation = leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
  return dimension.direction === 'higher' ? relation : -relation;
}

function normalizedValue(value: number | string, dimension: NormalizedMetric): number {
  if (typeof value === 'number') return value;
  if (dimension.id !== 'access') return Number.NaN;
  const order = { legally_unavailable: 0, high_barriers: 1, available: 2 } as const;
  return order[value as keyof typeof order] ?? Number.NaN;
}

function isSourcedFact<T>(
  fact: CountryComparisonFact<T>,
): fact is Extract<CountryComparisonFact<T>, { status: 'available' }> {
  return (
    fact.status === 'available' && fact.sources.length > 0 && fact.sources.every(isValidEvidence)
  );
}

function isValidEvidence(source: ComparisonEvidence): boolean {
  if (!source.title || !isValidDate(source.capturedAt)) return false;
  if (source.kind === 'candidate_profile') return true;
  if (!source.url || !Number.isInteger(source.dataYear) || Number(source.dataYear) < 1)
    return false;
  try {
    return new URL(source.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function visibleFact<T>(
  fact: CountryComparisonFact<T>,
  metric: MatrixMetric,
): CountryComparisonFact<T> {
  if (fact.status !== 'available') return fact;
  if (!isSourcedFact(fact))
    return { status: 'no_data', reason: 'Для этого значения нет проверяемого источника и даты.' };
  const reason = validateMetricValue(metric, fact);
  if (reason) return { status: 'no_data', reason };
  return fact;
}

function matchesFactValue(
  country: CountryComparisonCountry,
  metric: MatrixMetric,
  value: number | string,
): boolean {
  const fact = country.facts[metric] as CountryComparisonFact<unknown>;
  if (fact.status !== 'available') return false;
  const factValue = fact.value as Record<string, unknown>;
  const observation = fact.pareto;
  switch (metric) {
    case 'access':
      return value === factValue.status;
    case 'processingTime':
      return value === factValue.amount && observation?.unit === factValue.unit;
    case 'relocationVacancies':
      return value === factValue.count && observation?.unit === 'vacancies';
    case 'salaryThreshold':
      return value === factValue.amount && observation?.unit === `${factValue.currency}/year`;
    case 'incomeTax':
      return (
        value === factValue.effectiveRate &&
        observation?.unit === 'percent' &&
        Number(factValue.effectiveRate) >= 0 &&
        Number(factValue.effectiveRate) <= 100
      );
    case 'netIncome':
    case 'monthlyRemainder':
      return value === factValue.amount && observation?.unit === `${factValue.currency}/month`;
    case 'workingLanguage':
    case 'familyAndResidence':
      return false;
  }
}

function validateMetricValue<T>(
  metric: MatrixMetric,
  fact: Extract<CountryComparisonFact<T>, { status: 'available' }>,
): string | null {
  const value = fact.value as Record<string, unknown>;
  const nonEmpty = (key: string) =>
    typeof value[key] === 'string' && Boolean((value[key] as string).trim());
  const finite = (key: string) => typeof value[key] === 'number' && Number.isFinite(value[key]);
  if (metric === 'workingLanguage' || metric === 'familyAndResidence') {
    return nonEmpty('summary') ? null : 'Для этого значения нет проверяемого описания.';
  }
  if (metric === 'relocationVacancies') {
    const sample = value.sampleSize;
    const count = value.count;
    const hasSampleSource = fact.sources.some(
      (source) => source.kind === 'vacancy_catalog' && source.sampleSize === sample,
    );
    if (
      !finite('count') ||
      !finite('sampleSize') ||
      !hasSampleSource ||
      Number(sample) < 1 ||
      Number(count) < 0 ||
      Number(count) > Number(sample) ||
      !nonEmpty('scope') ||
      !isValidDate(String(value.periodStart)) ||
      !isValidDate(String(value.periodEnd)) ||
      String(value.periodStart) > String(value.periodEnd)
    ) {
      return 'Для числа вакансий нужны выборка и корректный период наблюдения.';
    }
    return null;
  }
  if (metric === 'access')
    return ['available', 'high_barriers', 'legally_unavailable'].includes(String(value.status)) &&
      nonEmpty('label')
      ? null
      : 'Для оценки доступности нет проверяемого статуса.';
  if (metric === 'incomeTax')
    return finite('effectiveRate') &&
      Number(value.effectiveRate) >= 0 &&
      Number(value.effectiveRate) <= 100 &&
      nonEmpty('basis')
      ? null
      : 'Для налоговой ставки нужна корректная ставка и расчётная база.';
  if (!finite('amount') || Number(value.amount) < 0 || !nonEmpty('basis'))
    return 'Для суммы нужна корректная величина и расчётная база.';
  if (metric === 'processingTime')
    return ['days', 'weeks'].includes(String(value.unit))
      ? null
      : 'Для срока оформления нужна единица измерения.';
  if (!nonEmpty('currency')) return 'Для суммы нужна валюта.';
  return null;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function insufficient(reason: string): ParetoResult {
  return {
    status: 'insufficient_data',
    dimensions: [],
    frontierCountryCodes: [],
    dominated: [],
    reason,
  };
}
