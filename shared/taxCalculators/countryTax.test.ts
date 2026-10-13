import { describe, expect, it } from 'vitest';
import { calculateAnnualIncomeTax, calculateAnnualPayroll, calculateDisposableIncome } from './index';

describe('country tax calculators', () => {
  it.each([
    ['DE', 30_000, 4_217],
    ['DE', 60_000, 14_233],
    ['DE', 100_000, 30_864],
    ['CY', 18_000, 0],
    ['CY', 42_000, 4_500],
    ['CY', 100_000, 23_300],
    ['RS', 600_000, 18_934.8],
    ['RS', 2_400_000, 198_934.8],
    ['RS', 7_200_000, 678_934.8],
    ['GE', 600_000, 120_000],
    ['GE', 2_400_000, 480_000],
    ['GE', 7_200_000, 1_440_000],
    ['AE', 600_000, 0],
    ['AE', 2_400_000, 0],
    ['AE', 7_200_000, 0],
    ['RU', 1_200_000, 156_000],
    ['RU', 3_600_000, 492_000],
    ['RU', 12_000_000, 1_962_000],
  ] as const)('%s tax on %s taxable income is %s', (countryCode, income, expectedTax) => {
    expect(calculateAnnualIncomeTax(countryCode, income).amount).toBe(expectedTax);
  });

  it('requires supported country data and finite non-negative amounts', () => {
    expect(() => calculateAnnualIncomeTax('XX', 100)).toThrow('Страна не поддерживается');
    expect(() => calculateAnnualIncomeTax('DE', Number.NaN)).toThrow('Доход должен быть конечным');
    expect(() => calculateAnnualIncomeTax('DE', -1)).toThrow('Доход не может быть отрицательным');
  });

  it('calculates employee contributions with current-year ceilings and profile assumptions', () => {
    const germany = calculateAnnualPayroll('DE', 120_000, { germanyChildless: true });
    expect(germany.employeeContributions.total).toBe(18_525.53);
    expect(germany.employeeContributions.items.map(({ name }) => name)).toEqual([
      'Пенсионное страхование',
      'Страхование от безработицы',
      'Медицинское страхование',
      'Страхование по уходу',
      'Надбавка по уходу для бездетных',
    ]);

    const serbia = calculateAnnualPayroll('RS', 600_000);
    expect(serbia.employeeContributions.total).toBe(122_497.24);

    const georgiaWithoutParticipation = calculateAnnualPayroll('GE', 600_000);
    const georgiaWithParticipation = calculateAnnualPayroll('GE', 600_000, {
      georgiaPensionParticipant: true,
    });
    expect(georgiaWithoutParticipation.employeeContributions.total).toBe(0);
    expect(georgiaWithParticipation.employeeContributions.total).toBe(12_000);
  });

  it('does not calculate disposable income without a sourced rent and insurance amount', () => {
    const payroll = calculateAnnualPayroll('DE', 60_000);
    const unavailable = calculateDisposableIncome(payroll, null, null);
    expect(unavailable).toMatchObject({ status: 'unavailable', amount: null, missing: ['rent', 'insurance'] });

    const source = {
      title: 'Официальные данные города',
      url: 'https://example.gov/rent',
      retrievedAt: '2026-10-10',
      dataYear: 2026,
    };
    const available = calculateDisposableIncome(
      payroll,
      { amount: 1_000, currency: 'EUR', source },
      { amount: 100, currency: 'EUR', source },
    );
    expect(available.status).toBe('available');
    expect(available.amount).toBeCloseTo(payroll.netMonthlyIncome - 1_100, 2);
  });
});
