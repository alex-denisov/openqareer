import { describe, expect, it } from 'vitest';
import { normalizeJsonSource } from './jsonSourceAdapters';

const OBSERVED_AT = '2026-10-25T00:00:00.000Z';

describe('Himalayas explicit salary period', () => {
  function salary(salaryPeriod: unknown) {
    return normalizeJsonSource(
      'src-himalayas-api',
      {
        jobs: [
          {
            guid: 'himalayas-salary-period',
            title: 'Frontend Developer',
            companyName: 'Example',
            description: 'Build software.',
            applicationLink: 'https://example.test/job',
            minSalary: 90000,
            maxSalary: 120000,
            currency: 'EUR',
            salaryPeriod,
          },
        ],
      },
      { observedAt: OBSERVED_AT },
    )[0]?.salary;
  }

  it.each([
    ['hourly', 'hour'],
    ['monthly', 'month'],
    ['annual', 'year'],
  ])('preserves explicit %s and its original provider field', (value, period) => {
    expect(salary(value)).toEqual({
      from: 90000,
      to: 120000,
      currency: 'EUR',
      period,
      periodEvidence: { field: 'himalayas.salaryPeriod', value },
    });
  });

  it.each([
    undefined,
    null,
    '',
    'weekly',
    'fortnightly',
    'yearly',
    'ANNUAL',
    ' annual ',
    12,
    { value: 'annual' },
  ])('keeps absent or unsupported period %j unknown without annual defaults', (value) => {
    expect(salary(value)).toEqual({ from: 90000, to: 120000, currency: 'EUR' });
  });
});
