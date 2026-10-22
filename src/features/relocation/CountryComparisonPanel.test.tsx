import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CountryComparisonPanel } from './CountryComparisonPanel';
import type { CountryComparisonCountry } from '../../../shared/countryFit/countryComparison';

const source = {
  kind: 'official' as const,
  title: 'Налоговый орган — ставка 2026',
  url: 'https://tax.example.org/rates',
  dataYear: 2026,
  capturedAt: '2026-10-10',
};

function country(code: string, rate: number, remainder: number): CountryComparisonCountry {
  const unavailable = {
    status: 'no_data' as const,
    reason: 'Нет проверенных данных для этого сценария.',
  };
  return {
    countryCode: code,
    countryName: code === 'DE' ? 'Германия' : 'Кипр',
    facts: {
      access: unavailable,
      processingTime: unavailable,
      relocationVacancies: unavailable,
      salaryThreshold: unavailable,
      incomeTax: {
        status: 'available',
        value: { effectiveRate: rate, basis: 'Один кандидат без иждивенцев' },
        sources: [source],
        pareto: {
          dimension: 'incomeTax',
          value: rate,
          direction: 'lower',
          basisKey: 'single-person-annual-income',
          unit: 'percent',
        },
      },
      netIncome: unavailable,
      monthlyRemainder: {
        status: 'available',
        value: { amount: remainder, currency: 'EUR', basis: 'Один кандидат, месяц' },
        sources: [source],
        pareto: {
          dimension: 'monthlyRemainder',
          value: remainder,
          direction: 'higher',
          basisKey: 'single-person-monthly-remainder',
          unit: 'EUR/month',
        },
      },
      workingLanguage: unavailable,
      familyAndResidence: unavailable,
    },
  };
}

describe('CountryComparisonPanel', () => {
  it('renders a sourced desktop matrix and a criterion-first mobile stack', () => {
    const html = renderToStaticMarkup(
      <CountryComparisonPanel countries={[country('DE', 24, 1000), country('CY', 30, 800)]} />,
    );

    expect(html).toContain('<table');
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain('career-country-comparison-mobile');
    expect(html).toContain('Германия');
    expect(html).toContain('24%');
    expect(html).toContain('Налоговый орган — ставка 2026');
    expect(html).toContain('год шкалы 2026');
    expect(html).toContain('Источники: ');
    expect(html).toContain('10.10.2026');
    expect(html).toContain('Граница Парето');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('marks every unsupported cell and avoids calculating a frontier from one measure', () => {
    const germany = country('DE', 24, 1000);
    const cyprusBase = country('CY', 30, 800);
    const cyprus: CountryComparisonCountry = {
      ...cyprusBase,
      facts: {
        ...cyprusBase.facts,
        monthlyRemainder: { status: 'no_data', reason: 'Нет данных об аренде и расходах.' },
      },
    };
    const html = renderToStaticMarkup(<CountryComparisonPanel countries={[germany, cyprus]} />);

    expect(html).toContain('нет данных');
    // The reason stays reachable as the cell's hint.
    expect(html).toContain('title="Нет данных об аренде и расходах."');
    expect(html).toContain('Граница Парето пока не рассчитывается');
  });

  it('renders loading, empty, and error states without fake actions', () => {
    expect(renderToStaticMarkup(<CountryComparisonPanel state="loading" />)).toContain(
      'aria-busy="true"',
    );
    expect(renderToStaticMarkup(<CountryComparisonPanel state="empty" />)).toContain(
      'Выберите страны для сравнения',
    );
    const retry = vi.fn();
    const error = renderToStaticMarkup(
      <CountryComparisonPanel
        state="error"
        errorMessage="Не удалось загрузить источники."
        onRetry={retry}
      />,
    );
    expect(error).toContain('Не удалось загрузить источники.');
    expect(error).toContain('Повторить загрузку');
    expect(
      renderToStaticMarkup(<CountryComparisonPanel state="error" errorMessage="Ошибка." />),
    ).not.toContain('<button');
  });
});
