import { describe, expect, it } from 'vitest';
import { evaluateCountryFit, getCountryMobilityData } from './index';
import { getVisibleThresholdSource } from './mobilityData';
import { calculateGermanOpportunityCardPoints } from './germanyOpportunityCard';
import type { MobilityRequirement } from './types';

const fiveCountries = ['RU', 'KZ', 'RS', 'AE', 'DE'] as const;

describe('Country Fit mobility scenarios', () => {
  it('returns the five scenarios from the EPIC for each supported fixture country', () => {
    for (const countryCode of fiveCountries) {
      const result = evaluateCountryFit(countryCode, {
        citizenshipCountryCodes: ['RU'],
        currentCountryCode: 'RU',
      });

      expect(result.scenarios.map(({ id }) => id)).toEqual([
        'domestic_market',
        'employer_sponsorship',
        'job_seeker_visa',
        'digital_nomad',
        'simple_mobility',
      ]);
    }
  });

  it('recognizes domestic market and EAEU mobility only from questionnaire citizenship/residence', () => {
    const russia = evaluateCountryFit('RU', {
      citizenshipCountryCodes: ['RU'],
      currentCountryCode: 'RU',
    });
    const kazakhstan = evaluateCountryFit('KZ', { citizenshipCountryCodes: ['RU'] });
    const germany = evaluateCountryFit('DE', { citizenshipCountryCodes: ['RU'] });

    expect(russia.scenarios.find(({ id }) => id === 'domestic_market')?.status).toBe('available');
    expect(kazakhstan.scenarios.find(({ id }) => id === 'simple_mobility')?.status).toBe('available');
    expect(germany.scenarios.find(({ id }) => id === 'simple_mobility')?.status).toBe('barriers');
  });

  it('does not infer a domestic market from only one non-matching identity field', () => {
    const result = evaluateCountryFit('DE', { citizenshipCountryCodes: ['RU'] });
    expect(result.scenarios.find(({ id }) => id === 'domestic_market')?.status).toBe('unknown');
  });

  it('evaluates the official Blue Card salary and qualification gates', () => {
    const result = evaluateCountryFit('DE', {
      citizenshipCountryCodes: ['RU'],
      hasJobOffer: true,
      annualOfferSalary: { amount: 50_700, currency: 'EUR' },
      recognizedDegreeCountryCodes: ['DE'],
      blueCardExceptionEligible: false,
      isItProfessional: false,
      relevantExperienceYears: 0,
    });
    expect(result.scenarios.find(({ id }) => id === 'employer_sponsorship')?.status).toBe('available');
  });

  it('checks the IT Blue Card experience window without assuming a degree', () => {
    const eligible = evaluateCountryFit('DE', {
      citizenshipCountryCodes: ['RU'],
      hasJobOffer: true,
      annualOfferSalary: { amount: 45_934.2, currency: 'EUR' },
      recognizedDegreeCountryCodes: [],
      isItProfessional: true,
      relevantExperienceYearsByWindow: { '7': 3 },
      blueCardExceptionEligible: false,
    });
    const insufficientExperience = evaluateCountryFit('DE', {
      citizenshipCountryCodes: ['RU'],
      hasJobOffer: true,
      annualOfferSalary: { amount: 45_934.2, currency: 'EUR' },
      recognizedDegreeCountryCodes: [],
      isItProfessional: true,
      relevantExperienceYearsByWindow: { '7': 2 },
      blueCardExceptionEligible: false,
    });

    expect(eligible.scenarios.find(({ id }) => id === 'employer_sponsorship')?.status).toBe('available');
    expect(insufficientExperience.scenarios.find(({ id }) => id === 'employer_sponsorship')?.status).toBe('barriers');
  });

  it('calculates Chancenkarte points from dated profile facts and leaves incomplete profiles unknown', () => {
    const profile = {
      qualificationRecognition: 'partially',
      shortageOccupation: true,
      experienceYearsLastFive: 2,
      experienceYearsLastSeven: 2,
      germanLevel: 'B1',
      englishLevel: 'B1',
      age: 30,
      germanyStayMonthsLastFive: 0,
      partnerQualifiedAndApplying: false,
    } as const;
    const score = calculateGermanOpportunityCardPoints(profile);
    const candidate = evaluateCountryFit('DE', {
      citizenshipCountryCodes: ['RU'],
      completedFormalQualification: true,
      minimumMonthlyFunds: { amount: 1_091, currency: 'EUR' },
      germanyOpportunityCard: profile,
    });

    expect(score).toEqual({ points: 11, complete: true, missingCriteria: [] });
    expect(candidate.scenarios.find(({ id }) => id === 'job_seeker_visa')?.status).toBe('available');

    const incomplete = calculateGermanOpportunityCardPoints({ ...profile, age: null, partnerQualifiedAndApplying: null });
    expect(incomplete.complete).toBe(false);
    expect(incomplete.missingCriteria).toContain('возраст');
  });

  it('includes Cyprus family income uplifts only when the family profile is known', () => {
    const incomplete = evaluateCountryFit('CY', {
      citizenshipCountryCodes: ['RU'],
      worksRemotelyForForeignEmployer: true,
      remoteMonthlyIncome: { amount: 3_500, currency: 'EUR' },
      remoteMonthlyIncomeIsNet: true,
      hasPrivateHealthInsurance: true,
    });
    const complete = evaluateCountryFit('CY', {
      citizenshipCountryCodes: ['RU'],
      worksRemotelyForForeignEmployer: true,
      remoteMonthlyIncome: { amount: 4_725, currency: 'EUR' },
      remoteMonthlyIncomeIsNet: true,
      hasPrivateHealthInsurance: true,
      family: { hasPartner: true, children: 1 },
    });
    const incompleteScenario = incomplete.scenarios.find(({ id }) => id === 'digital_nomad');
    const completeScenario = complete.scenarios.find(({ id }) => id === 'digital_nomad');

    expect(incompleteScenario?.status).toBe('unknown');
    expect(completeScenario?.status).toBe('available');
    expect(completeScenario?.thresholds.find(({ requirement }) => requirement === 'minimum_remote_income')?.amount).toBe(4_725);
  });

  it('checks country-specific income thresholds against the matching sourced profile amount', () => {
    const unitedArabEmirates = getCountryMobilityData('AE');
    const remoteRule = unitedArabEmirates.scenarios.find(({ id }) => id === 'digital_nomad');
    const threshold = remoteRule?.paths
      .flatMap(({ requirements }) => requirements)
      .find(({ kind }) => kind === 'minimum_remote_income');
    expect(threshold?.kind).toBe('minimum_remote_income');

    if (threshold?.kind !== 'minimum_remote_income') throw new Error('Не найден порог удалённого дохода ОАЭ');
    const candidate = {
      citizenshipCountryCodes: ['RU'],
      remoteMonthlyIncome: { amount: threshold.amount, currency: threshold.currency },
      worksRemotelyForForeignEmployer: true,
      hasPrivateHealthInsurance: true,
    };
    const result = evaluateCountryFit('AE', candidate);
    expect(result.scenarios.find(({ id }) => id === 'digital_nomad')?.status).toBe('available');
  });

  it('does not show unsupported thresholds as zeros or as legal rejections', () => {
    const result = evaluateCountryFit('US', { citizenshipCountryCodes: [] });
    expect(result.scenarios).toHaveLength(5);
    expect(result.scenarios.every(({ status }) => status === 'unknown' || status === 'barriers')).toBe(true);
    expect(result.scenarios.flatMap(({ thresholds }) => thresholds)).toEqual([]);
  });

  it('does not equate Serbian visa-free entry with EAEU work rights', () => {
    const result = evaluateCountryFit('RS', {
      citizenshipCountryCodes: ['RU'],
      hasLocalWorkAuthorizationCountryCodes: [],
      shortTermWorkExceptionByCountry: { RS: false },
    });
    const simpleMobility = result.scenarios.find(({ id }) => id === 'simple_mobility');
    expect(simpleMobility?.status).toBe('barriers');
    expect(simpleMobility?.reasons.join(' ')).toContain('разрешен');
  });

  it('limits Serbia short-term work exceptions to the sourced stay duration', () => {
    const base = {
      citizenshipCountryCodes: ['RU'],
      hasLocalWorkAuthorizationCountryCodes: [],
      shortTermWorkExceptionByCountry: { RS: true },
    };
    const withinException = evaluateCountryFit('RS', { ...base, stayDurationDays: 90 });
    const beyondException = evaluateCountryFit('RS', { ...base, stayDurationDays: 91 });

    expect(withinException.scenarios.find(({ id }) => id === 'simple_mobility')?.status).toBe('available');
    expect(beyondException.scenarios.find(({ id }) => id === 'simple_mobility')?.status).toBe('barriers');
  });

  it('attaches a dated official source to every displayed numeric threshold', () => {
    const data = getCountryMobilityData('DE');
    for (const threshold of data.scenarios.flatMap(({ paths }) => paths.flatMap(({ requirements }) => requirements))) {
      if (!('amount' in threshold)) continue;
      expect(threshold.source.url).toMatch(/^https:\/\//);
      expect(Number.isInteger(threshold.source.dataYear)).toBe(true);
      expect(threshold.source.retrievedAt).toBe('2026-10-10');
    }
  });

  it('hides a numeric requirement when its source is missing or malformed', () => {
    const missingSource = {
      kind: 'minimum_annual_salary',
      amount: 1,
      currency: 'EUR',
    } as unknown as MobilityRequirement;
    const invalidSource = {
      kind: 'minimum_annual_salary',
      amount: 1,
      currency: 'EUR',
      source: { title: 'Источник', url: 'http://example.test', dataYear: 2026, retrievedAt: '2026-10-10' },
    } as unknown as MobilityRequirement;
    expect(getVisibleThresholdSource(missingSource)).toBeNull();
    expect(getVisibleThresholdSource(invalidSource)).toBeNull();
  });
});
