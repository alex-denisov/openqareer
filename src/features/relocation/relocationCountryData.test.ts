import { describe, expect, it } from 'vitest';
import { emptyRelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import {
  buildCountryComparisonCountry,
  calculateRelocationEconomy,
  listRelocationCountries,
  mobilityCandidateFromQuestionnaire,
  countryFitForQuestionnaire,
} from './relocationCountryData';

describe('relocation country data', () => {
  it('keeps mobility requirements unknown when the questionnaire has no candidate facts', () => {
    const profile = emptyRelocationQuestionnaire();

    expect(withoutDocumentClock(mobilityCandidateFromQuestionnaire(profile))).toEqual({
      citizenshipCountryCodes: [],
    });
    expect(countryFitForQuestionnaire('DE', profile).status).toBe('unknown');
  });

  it('maps only confirmed questionnaire facts into the mobility engine', () => {
    const profile = {
      ...emptyRelocationQuestionnaire(),
      citizenshipDocuments: {
        citizenshipCountryCodes: ['RU'],
        documents: [],
      },
      education: {
        education: [
          {
            id: 'degree-1',
            level: 'bachelor' as const,
            title: 'Информатика',
            countryCode: 'RU',
            completedAt: '2020-06-30',
            recognitionStatus: 'recognized' as const,
          },
        ],
        certificates: [],
      },
    };

    expect(withoutDocumentClock(mobilityCandidateFromQuestionnaire(profile))).toEqual({
      citizenshipCountryCodes: ['RU'],
      recognizedDegreeCountryCodes: ['RU'],
      completedFormalQualification: true,
    });
    expect(countryFitForQuestionnaire('KZ', profile).status).toBe('available');
  });

  it('lists countries from the existing mobility catalog and marks tax support separately', () => {
    const countries = listRelocationCountries();

    expect(countries.map(({ countryCode }) => countryCode)).toContain('DE');
    expect(countries.map(({ countryCode }) => countryCode)).toContain('RS');
    expect(countries.find(({ countryCode }) => countryCode === 'DE')).toMatchObject({
      name: 'Германия',
      taxSupported: true,
    });
    expect(countries.find(({ countryCode }) => countryCode === 'SG')).toMatchObject({
      name: 'Сингапур',
      taxSupported: false,
    });
  });

  it('returns sourced net income but keeps the monthly remainder unavailable without rent and insurance', () => {
    const economy = calculateRelocationEconomy('DE', 60_000);

    expect(economy.status).toBe('available');
    if (economy.status !== 'available') throw new Error('Expected supported tax calculation');
    expect(economy.payroll.taxYear).toBe(2026);
    expect(economy.disposableIncome).toMatchObject({
      status: 'unavailable',
      amount: null,
      missing: ['rent', 'insurance'],
    });
  });

  it('does not invent a tax calculation for a country outside B353 coverage', () => {
    expect(calculateRelocationEconomy('SG', 60_000)).toMatchObject({
      status: 'unsupported',
      reason: expect.any(String),
    });
  });

  it('shows sourced threshold and net-income facts without claiming comparable disposable income', () => {
    const country = buildCountryComparisonCountry('DE', emptyRelocationQuestionnaire(), 60_000);

    expect(country.facts.salaryThreshold.status).toBe('available');
    expect(country.facts.netIncome.status).toBe('available');
    expect(country.facts.monthlyRemainder).toMatchObject({ status: 'no_data' });
    if (country.facts.netIncome.status !== 'available') throw new Error('Expected net-income fact');
    expect(country.facts.netIncome.sources[0]).toMatchObject({
      kind: 'official',
      dataYear: 2026,
      url: expect.stringMatching(/^https:\/\//u),
    });
    expect(country.facts.netIncome.pareto).toBeUndefined();
  });
});

describe('comparison rows of mockup 15 without a salary', () => {
  it('names the income tax from the country scale: flat, progressive or none', () => {
    const tax = (code: string) => {
      const fact = buildCountryComparisonCountry(code, emptyRelocationQuestionnaire()).facts
        .incomeTax;
      return fact.status === 'available' ? fact.value.label : fact.status;
    };
    expect(tax('AM')).toBe('20 %, плоский');
    expect(tax('KZ')).toMatch(/^прогрессивный, до \d+ %$/u);
    expect(tax('DE')).toBe('прогрессивный, до 45 %');
    expect(tax('AE')).toBe('0 %');
    expect(tax('SG')).toBe('no_data');
  });
});

function withoutDocumentClock<
  T extends { readonly asOf?: string; readonly residenceDocuments?: unknown },
>(candidate: T): Omit<T, 'asOf' | 'residenceDocuments'> {
  const { asOf: _asOf, residenceDocuments: _documents, ...rest } = candidate;
  return rest;
}
