import { describe, expect, it } from 'vitest';
import { evaluateCountryFit, getCountryMobilityData } from './index';
import { isVerifiableSource } from './mobilitySources';
import type { MobilityCandidateProfile, MobilityScenarioId, ScenarioAvailability } from './types';

/** The six Country Fit countries plus GB: every scenario is backed by an official source. */
const coveredCountries = ['DE', 'CY', 'RS', 'AE', 'GE', 'RU', 'GB'] as const;

/** A typical candidate: Russian citizen in Russia, a degree, remote income from a foreign employer. */
const typicalCandidate: MobilityCandidateProfile = {
  citizenshipCountryCodes: ['RU'],
  currentCountryCode: 'RU',
  hasBachelorDegree: true,
  completedFormalQualification: true,
  worksRemotelyForForeignEmployer: true,
  remoteMonthlyIncome: { amount: 4_000, currency: 'EUR' },
  remoteMonthlyIncomeIsNet: true,
};

function statusOf(
  countryCode: string,
  scenarioId: MobilityScenarioId,
  candidate = typicalCandidate,
) {
  return evaluateCountryFit(countryCode, candidate).scenarios.find(({ id }) => id === scenarioId);
}

describe('Country Fit route coverage', () => {
  it.each(coveredCountries)(
    '%s has a verified rule set or a sourced «no route» for every scenario',
    (countryCode) => {
      const data = getCountryMobilityData(countryCode);
      for (const scenario of data.scenarios) {
        expect(scenario.dataStatus, `${countryCode} × ${scenario.id}`).not.toBe('no_data');
        if (scenario.dataStatus === 'unavailable') {
          expect(scenario.reason, `${countryCode} × ${scenario.id}`).toBeTruthy();
          expect(scenario.sources?.length, `${countryCode} × ${scenario.id}`).toBeGreaterThan(0);
        }
      }
    },
  );

  it('dates every official source and keeps it verifiable', () => {
    for (const countryCode of coveredCountries) {
      const scenarios = getCountryMobilityData(countryCode).scenarios;
      const sources = scenarios.flatMap((scenario) => [
        ...(scenario.sources ?? []),
        ...scenario.paths.flatMap(({ requirements }) =>
          requirements.flatMap((requirement) =>
            'source' in requirement ? [requirement.source] : [],
          ),
        ),
      ]);
      for (const source of sources) {
        expect(isVerifiableSource(source), source.url).toBe(true);
        expect(source.retrievedAt).toMatch(/^2026-\d{2}-\d{2}$/);
        expect(Number.isInteger(source.dataYear)).toBe(true);
      }
    }
  });

  it.each<[string, MobilityScenarioId, ScenarioAvailability]>([
    ['GE', 'domestic_market', 'barriers'],
    ['GE', 'employer_sponsorship', 'unknown'],
    ['GE', 'job_seeker_visa', 'unavailable'],
    ['GE', 'digital_nomad', 'available'],
    ['GE', 'simple_mobility', 'unknown'],
    ['CY', 'employer_sponsorship', 'unknown'],
    ['CY', 'job_seeker_visa', 'unavailable'],
    ['CY', 'digital_nomad', 'unknown'],
    ['RS', 'job_seeker_visa', 'unavailable'],
    ['RS', 'digital_nomad', 'unavailable'],
    ['AE', 'job_seeker_visa', 'unknown'],
    ['AE', 'simple_mobility', 'unknown'],
    ['DE', 'digital_nomad', 'unknown'],
    ['GB', 'job_seeker_visa', 'unknown'],
    ['GB', 'digital_nomad', 'unavailable'],
    ['GB', 'simple_mobility', 'barriers'],
    ['RU', 'domestic_market', 'available'],
    ['RU', 'employer_sponsorship', 'unknown'],
    ['RU', 'job_seeker_visa', 'unavailable'],
    ['RU', 'digital_nomad', 'unavailable'],
    ['RU', 'simple_mobility', 'available'],
  ])('typical candidate: %s × %s is %s', (countryCode, scenarioId, expected) => {
    expect(statusOf(countryCode, scenarioId)?.status).toBe(expected);
  });

  it('shows the official source next to a «no route» answer', () => {
    const scenario = statusOf('GE', 'job_seeker_visa');
    expect(scenario?.reasons.join(' ')).toMatch(/поиск/i);
    expect(scenario?.sources.length).toBeGreaterThan(0);
  });

  it('does not reject citizenships missing from the verified Georgian visa-free list', () => {
    const result = statusOf('GE', 'digital_nomad', {
      ...typicalCandidate,
      citizenshipCountryCodes: ['IN'],
    });
    expect(result?.status).toBe('unknown');
  });

  it('keeps Georgian local work behind the right to work even with visa-free entry', () => {
    const withoutRight = statusOf('GE', 'simple_mobility');
    const withRight = statusOf('GE', 'simple_mobility', {
      ...typicalCandidate,
      hasLocalWorkAuthorizationCountryCodes: ['GE'],
    });
    expect(withoutRight?.reasons.join(' ')).toMatch(/прав/i);
    expect(withRight?.status).toBe('available');
  });

  it('checks the Cyprus foreign-interest company salary per month', () => {
    const offer: MobilityCandidateProfile = {
      ...typicalCandidate,
      hasJobOffer: true,
      approvedEmployerSponsor: true,
      monthlyOfferSalary: { amount: 2_500, currency: 'EUR' },
    };
    expect(statusOf('CY', 'employer_sponsorship', offer)?.status).toBe('available');
    expect(
      statusOf('CY', 'employer_sponsorship', {
        ...offer,
        monthlyOfferSalary: { amount: 2_499, currency: 'EUR' },
      })?.paths.find(({ id }) => id === 'cyprus-foreign-interest-degree')?.status,
    ).toBe('barriers');
  });

  it('checks UK High Potential Individual savings, English and graduation window', () => {
    const graduate: MobilityCandidateProfile = {
      ...typicalCandidate,
      recentTopUniversityGraduateWithinYearsByCountry: { GB: 4 },
      meetsLanguageRequirementsByCountry: { GB: true },
      availableSavings: { amount: 1_270, currency: 'GBP' },
    };
    const scenario = statusOf('GB', 'job_seeker_visa', graduate);
    expect(scenario?.status).toBe('available');
    expect(
      scenario?.thresholds.find(({ requirement }) => requirement === 'minimum_savings'),
    ).toMatchObject({
      amount: 1_270,
      currency: 'GBP',
      period: 'one_time',
    });
    expect(
      statusOf('GB', 'job_seeker_visa', {
        ...graduate,
        availableSavings: { amount: 1_000, currency: 'GBP' },
      })?.paths.find(({ id }) => id === 'high-potential-individual')?.status,
    ).toBe('barriers');
  });

  it('compares a quarterly Russian threshold with three monthly salaries', () => {
    const offer: MobilityCandidateProfile = { citizenshipCountryCodes: ['KZ'], hasJobOffer: true };
    const pass = statusOf('RU', 'employer_sponsorship', {
      ...offer,
      monthlyOfferSalary: { amount: 250_000, currency: 'RUB' },
    });
    const fail = statusOf('RU', 'employer_sponsorship', {
      ...offer,
      monthlyOfferSalary: { amount: 249_999, currency: 'RUB' },
    });
    expect(pass?.paths.find(({ id }) => id === 'russia-highly-qualified-specialist')?.status).toBe(
      'available',
    );
    expect(fail?.paths.find(({ id }) => id === 'russia-highly-qualified-specialist')?.status).toBe(
      'barriers',
    );
    expect(pass?.thresholds.find(({ amount }) => amount === 750_000)).toMatchObject({
      currency: 'RUB',
      period: 'quarterly',
    });
  });

  it('does not ask for UAE job-seeker health insurance the official page does not list', () => {
    const result = statusOf('AE', 'job_seeker_visa', {
      ...typicalCandidate,
      jobSeekerCategoryEligibleByCountry: { AE: true },
      financialGuaranteeSatisfiedByCountry: ['AE'],
    });
    expect(result?.status).toBe('available');
  });
});
