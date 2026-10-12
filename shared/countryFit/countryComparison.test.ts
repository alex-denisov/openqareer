import { describe, expect, it } from 'vitest';
import {
  calculateParetoFrontier,
  visibleFact,
  type ComparisonEvidence,
  type CountryComparisonCountry,
  type CountryComparisonFact,
} from './countryComparison';

const officialSource: ComparisonEvidence = {
  kind: 'official',
  title: 'Официальный источник, шкала 2026',
  url: 'https://example.org/facts',
  dataYear: 2026,
  capturedAt: '2026-10-10',
};

type AvailableFact<T> = Extract<CountryComparisonFact<T>, { readonly status: 'available' }>;

function numericFact(
  metric: 'incomeTax',
  value: number,
  basisKey?: string,
  unit?: string,
): AvailableFact<{ readonly effectiveRate: number; readonly basis: string }>;
function numericFact(
  metric: 'monthlyRemainder',
  value: number,
  basisKey?: string,
  unit?: string,
): AvailableFact<{ readonly amount: number; readonly currency: string; readonly basis: string }>;
function numericFact(
  metric: 'incomeTax' | 'monthlyRemainder',
  value: number,
  basisKey?: string,
  unit?: string,
): AvailableFact<
  | { readonly effectiveRate: number; readonly basis: string }
  | { readonly amount: number; readonly currency: string; readonly basis: string }
> {
  const resolvedBasis =
    basisKey ??
    (metric === 'incomeTax' ? 'single-person-annual-income' : 'single-person-monthly-remainder');
  const resolvedUnit = unit ?? (metric === 'incomeTax' ? 'percent' : 'EUR/month');
  return {
    status: 'available',
    value:
      metric === 'incomeTax'
        ? { effectiveRate: value, basis: 'Один кандидат без иждивенцев' }
        : { amount: value, currency: 'EUR', basis: 'Один кандидат, месяц' },
    sources: [officialSource],
    pareto: {
      dimension: metric,
      value,
      direction: metric === 'incomeTax' ? 'lower' : 'higher',
      basisKey: resolvedBasis,
      unit: resolvedUnit,
    },
  } as AvailableFact<
    | { readonly effectiveRate: number; readonly basis: string }
    | { readonly amount: number; readonly currency: string; readonly basis: string }
  >;
}

function country(
  countryCode: string,
  incomeTax: CountryComparisonCountry['facts']['incomeTax'],
  monthlyRemainder: CountryComparisonCountry['facts']['monthlyRemainder'],
): CountryComparisonCountry {
  const noData = { status: 'no_data' as const, reason: 'Нет сопоставимых данных.' };
  return {
    countryCode,
    countryName: countryCode,
    facts: {
      access: noData,
      processingTime: noData,
      relocationVacancies: noData,
      salaryThreshold: noData,
      incomeTax,
      netIncome: noData,
      monthlyRemainder,
      workingLanguage: noData,
      familyAndResidence: noData,
    },
  };
}

describe('calculateParetoFrontier', () => {
  it('finds the nondominated country across two sourced, comparable measures', () => {
    const result = calculateParetoFrontier([
      country('DE', numericFact('incomeTax', 24), numericFact('monthlyRemainder', 1000)),
      country('CY', numericFact('incomeTax', 30), numericFact('monthlyRemainder', 800)),
      country('RS', numericFact('incomeTax', 20), numericFact('monthlyRemainder', 700)),
    ]);

    expect(result.status).toBe('ready');
    expect(result.dimensions).toEqual(['incomeTax', 'monthlyRemainder']);
    expect(result.frontierCountryCodes).toEqual(['DE', 'RS']);
    expect(result.dominated).toEqual([{ countryCode: 'CY', byCountryCodes: ['DE'] }]);
  });

  it('does not rank countries when fewer than two common measures are comparable', () => {
    const result = calculateParetoFrontier([
      country('DE', numericFact('incomeTax', 24), {
        status: 'no_data',
        reason: 'Нет источника расходов.',
      }),
      country('CY', numericFact('incomeTax', 30), {
        status: 'no_data',
        reason: 'Нет источника расходов.',
      }),
    ]);

    expect(result.status).toBe('insufficient_data');
    expect(result.frontierCountryCodes).toEqual([]);
    expect(result.reason).toContain('две общие сопоставимые метрики');
  });

  it('excludes currencies or calculation bases that differ across countries', () => {
    const euro = numericFact('monthlyRemainder', 900);
    const dollars = {
      ...numericFact('monthlyRemainder', 1100),
      value: { amount: 1100, currency: 'USD', basis: 'Один кандидат, месяц' },
      pareto: { ...numericFact('monthlyRemainder', 1100).pareto!, unit: 'USD/month' },
    };
    const otherBase = numericFact('incomeTax', 26, 'family-of-three-annual-income');
    const result = calculateParetoFrontier([
      country('DE', numericFact('incomeTax', 24), euro),
      country('US', otherBase, dollars),
    ]);

    expect(result.status).toBe('insufficient_data');
  });

  it('ignores values with invalid or missing evidence', () => {
    const unsupported = {
      ...numericFact('incomeTax', 24),
      sources: [{ ...officialSource, url: 'http://example.org/facts' }],
    };
    const result = calculateParetoFrontier([
      country('DE', unsupported, numericFact('monthlyRemainder', 1000)),
      country('CY', numericFact('incomeTax', 30), numericFact('monthlyRemainder', 800)),
    ]);

    expect(result.status).toBe('insufficient_data');
    expect(visibleFact(unsupported, 'incomeTax')).toMatchObject({ status: 'no_data' });
  });

  it('does not accept non-finite measures or inconsistent directions', () => {
    const nan = numericFact('incomeTax', Number.NaN);
    const reversed = {
      ...numericFact('incomeTax', 30),
      pareto: { ...numericFact('incomeTax', 30).pareto!, direction: 'higher' as const },
    };
    const result = calculateParetoFrontier([
      country('DE', nan, numericFact('monthlyRemainder', 1000)),
      country('CY', reversed, numericFact('monthlyRemainder', 800)),
    ]);

    expect(result.status).toBe('insufficient_data');
    expect(visibleFact(nan, 'incomeTax')).toMatchObject({ status: 'no_data' });
  });
});

describe('visibleFact', () => {
  it('requires a catalog sample and period before showing vacancy counts', () => {
    const vacancy = {
      status: 'available' as const,
      value: {
        count: 31,
        sampleSize: 40,
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        scope: 'инженерные роли',
      },
      sources: [officialSource],
    };

    expect(visibleFact(vacancy, 'relocationVacancies')).toMatchObject({ status: 'no_data' });
  });
});
